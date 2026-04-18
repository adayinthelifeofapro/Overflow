# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack summary

- **.NET 10** (pinned in [global.json](global.json), `rollForward: latestMajor`, prerelease allowed) orchestrated by **.NET Aspire 13.2**.
- **Next.js 16.2 / React 19** frontend in [webapp/](webapp/) using the App Router, Tailwind v4, HeroUI, and the React Compiler (`reactCompiler: true` in [webapp/next.config.ts](webapp/next.config.ts)).
- Infra resources (Postgres, Keycloak, Typesense, RabbitMQ, YARP gateway) are declared in code by the AppHost — do not start them manually.

## Running the system

The AppHost in [Overflow.AppHost/AppHost.cs](Overflow.AppHost/AppHost.cs) is the single entry point. [aspire.config.json](aspire.config.json) points to it.

```bash
# Run everything (Aspire dashboard, services, infra, webapp)
aspire run
# or
dotnet run --project Overflow.AppHost/Overflow.AppHost.csproj

# Build solution
dotnet build Overflow.sln

# Webapp (only needed when running it in isolation — AppHost launches it via AddJavaScriptApp)
cd webapp && npm run dev     # dev server
cd webapp && npm run build   # production build
cd webapp && npm run lint    # eslint (flat config, eslint-config-next)

# EF Core migrations (QuestionService owns the only DbContext)
dotnet ef migrations add <Name> --project QuestionService
dotnet ef database update   --project QuestionService
```

The QuestionService applies migrations automatically on startup ([QuestionService/Program.cs](QuestionService/Program.cs) calls `context.Database.MigrateAsync()`).

There is no test project in the solution — do not invent test commands.

## Architecture (big picture)

Event-driven microservices behind a YARP gateway, wired together by Aspire.

```
    Next.js webapp ──HTTP──▶ YARP gateway (:8001) ──▶ QuestionService  (Postgres, owns writes)
                                                 └─▶ SearchService    (Typesense, read-only)
                                                         ▲
                              QuestionService ──Wolverine/RabbitMQ──┘  (exchange: "questions")
```

- **[Overflow.AppHost](Overflow.AppHost/AppHost.cs)** is the distributed-app manifest. It wires service discovery, env vars, connection strings, and wait-for dependencies. Gateway routes are defined here: `/questions` and `/tags` → QuestionService; `/search` → SearchService. In non-Development environments it also adds an `nginx-proxy` sidecar (virtual hosts `api.overflow.local`, `id.overflow.local`).
- **[QuestionService](QuestionService/)** — ASP.NET Core controllers backed by EF Core on Postgres (`questionDb`). Owns `Question`, `Answer`, `Tag`. Tags are seeded via `OnModelCreating` in [QuestionDbContext](QuestionService/Data/QuestionDbContext.cs) and validated via a cached `TagService`. Auth is Keycloak JWT bearer (`[Authorize]` endpoints read `ClaimTypes.NameIdentifier` and the `name` claim). On every write it publishes a contract via Wolverine: `QuestionCreated`, `QuestionUpdated`, `QuestionDeleted`, `UpdatedAnswerCount`, `AnswerAccepted`.
- **[SearchService](SearchService/)** — minimal API + Wolverine message handlers in [MessageHandlers/](SearchService/MessageHandlers/). Indexes the `questions` Typesense collection (schema ensured on startup by [SearchInitializer](SearchService/Data/SearchInitializer.cs)). Exposes `GET /search?query=...` and `GET /search/similar-titles` — `[tag]` syntax inside the query is parsed into a Typesense `filter_by`.
- **[Contracts](Contracts/)** — shared record types for the message bus. Both services reference this project; never duplicate these types.
- **[Common](Common/)** — shared extension methods only:
  - `AddKeyCloakAuthentication` ([Common/AuthExtensions.cs](Common/AuthExtensions.cs)) — fixed realm `overflow`, audience `overflow`, three valid issuers (localhost dev, docker, nginx-proxy virtual host).
  - `UseWolverineWithRabbitMqAsync` ([Common/WolverineExtensions.cs](Common/WolverineExtensions.cs)) — Polly retry on broker unreachable (5 attempts, exponential backoff), auto-provisions the `questions` exchange, adds Wolverine OTel source.
- **[Overflow.ServiceDefaults](Overflow.ServiceDefaults/Extensions.cs)** — the standard Aspire defaults project (OpenTelemetry, service discovery, resilient HTTP clients, `/health` + `/alive`). Every service project calls `builder.AddServiceDefaults()`.
- **[webapp](webapp/)** — Next.js App Router. Server actions in [src/lib/actions/](webapp/src/lib/actions/) currently call `http://localhost:7001/questions` directly rather than going through the gateway; keep this in mind when editing — if you change the gateway port/route, update the server actions too.

### Messaging contract

- Wolverine on QuestionService: `PublishAllMessages().ToRabbitExchange("questions")`.
- Wolverine on SearchService: listens on queue `questions.search` bound to exchange `questions`.
- The exchange is declared in `Common.WolverineExtensions` so either side can start first.

### Adding a new event

1. Add a record to [Contracts/](Contracts/).
2. Publish it from QuestionService via `IMessageBus.PublishAsync(...)` after `SaveChangesAsync`.
3. Add a handler class in [SearchService/MessageHandlers/](SearchService/MessageHandlers/) with an `async Task HandleAsync(TMessage message)` method — Wolverine discovers it by convention because `opts.ApplicationAssembly = typeof(Program).Assembly` is set.

## Critical conventions

- **Do not introduce a second DbContext.** Only QuestionService talks to Postgres; SearchService is read-only against Typesense. Cross-service reads go through events, not direct DB access.
- **Service-to-service URLs** come from Aspire service discovery / YARP; do not hardcode ports in the .NET projects. The one exception is the webapp server action noted above.
- **Keycloak realm is `overflow`** and the import file lives at [infra/realms/](infra/realms/). Don't change the realm name without updating `AuthExtensions` and the AppHost `WithRealmImport` call.
- **The `questions` RabbitMQ exchange name is load-bearing** — it appears in both services and in `Common.WolverineExtensions`. Changing it requires updating all three.

## Webapp-specific guidance

[webapp/AGENTS.md](webapp/AGENTS.md) flags that this Next.js version has **breaking changes vs. pre-16 knowledge**: read `webapp/node_modules/next/dist/docs/` for the relevant API before editing App Router / server-action code rather than relying on training data. [webapp/CLAUDE.md](webapp/CLAUDE.md) aliases to the same file.

## Repo layout reference

- [Overflow.sln](Overflow.sln) — solution groups: `services` (QuestionService, SearchService), `common` (Contracts, Common), plus `Overflow.AppHost` and `Overflow.ServiceDefaults` at the root.
- [infra/docker-compose.yaml](infra/docker-compose.yaml) — generated production compose file for the `production` Docker Compose environment declared in AppHost. Do not hand-edit; regenerate via Aspire publishing if needed.
