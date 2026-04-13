using System.ComponentModel.DataAnnotations;
using QuestionService.Validators;

namespace QuestionService.Dtos;

public record CreateQuestionDto(
    [Required] string Title,
    [Required] string Content, 
    [Required] [TagListValidator(1, 5)] List<string> Tags);