import {getQuestionById} from "@/lib/actions/question-actions";
import QuestionDetailedHeader from "@/app/questions/[id]/QuestionDetailedHeader";
import {notFound} from "next/navigation";
import QuestionContent from "@/app/questions/[id]/QuestionContent";
import AnswerContent from "@/app/questions/[id]/AnswerContent";
import AnswersHeader from "@/app/questions/[id]/AnswersHeader";

type Params = Promise<{id: string}>

export default async function QuestionDetailedPage({params}: {params: Params}) {
    const {id} = await params;
    const question = await getQuestionById(id);
    
    if(!question) return notFound();
    
    return (
        <div className='w-full'>
            <QuestionDetailedHeader question={question} />
            <QuestionContent question={question} />
            {question.answers.length > 0 && (
                <AnswersHeader answerCount={question.answers.length} />
            )}
            {question.answers.map(answer => (
                <AnswerContent answer={answer} key={answer.id}></AnswerContent>
            ))}
        </div>
    );
}