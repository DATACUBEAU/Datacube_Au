// This file is for Zod schemas and TypeScript types that are shared
// between client and server components for AU flows.
// Do NOT add 'use server' to this file.

import { z } from 'zod';

// For: generate-exam-predictions.ts
export const PredictionDetailSchema = z.object({
  topic: z.string().describe('The name of the predicted exam topic.'),
  likelihood: z.number().describe('The percentage likelihood of this topic appearing on the exam (e.g., 78 for 78%).'),
  rationale: z.string().describe('A brief explanation for why this topic is considered likely (e.g., "Appears in 4 of the last 6 exams").'),
  commonMistake: z.string().describe('A common mistake students make when answering questions on this topic.'),
  examTip: z.string().describe('A specific, actionable tip on how examiners expect the answer to be structured or what to include.')
});
export type PredictionDetail = z.infer<typeof PredictionDetailSchema>;

export const GenerateExamPredictionsOutputSchema = z.object({
  topicWeights: z
    .string()
    .describe('A numbered list of the top 5 most important topics and their percentage weight (e.g., "1. Quantum Physics: 45%").'),
  predictions: z.array(PredictionDetailSchema).describe("An array of detailed predictions for likely exam topics.")
});
export type GenerateExamPredictionsOutput = z.infer<typeof GenerateExamPredictionsOutputSchema>;


// For: summarize-text.ts
export const SummarizeTextInputSchema = z.object({
  textToSummarize: z.string().describe('The text content to be summarized.'),
  strength: z.enum(['brief', 'medium', 'detailed']).describe('The desired level of summary detail.'),
});
export type SummarizeTextInput = z.infer<typeof SummarizeTextInputSchema>;

// For: rag-based-question-answering.ts
export const RagBasedQuestionAnsweringOutputSchema = z.object({
  answer: z.string().describe('The answer to the user question based on the document.'),
  citations: z.array(z.string()).describe('A list containing the filename of the document(s) that were used.'),
});
export type RagBasedQuestionAnsweringOutput = z.infer<typeof RagBasedQuestionAnsweringOutputSchema>;

// For: auto-generate-study-materials.ts
export const GenerateStudyMaterialsOutputSchema = z.object({
  summary: z.string().describe('A concise summary of the document.'),
  keyPoints: z.string().describe('A string containing a numbered list of the most important points. Each point on a new line.'),
  conceptMap: z.string().describe("A descriptive paragraph explaining the core concepts. For each key concept, wrap the term in single quotes and IMMEDIATELY follow it with its definition in parentheses. Example: 'Matter' (Anything that has mass and volume) is a central concept. This branches into 'Properties' (Characteristics of a substance) and 'States' (Solid, Liquid, Gas)."),
  topicRelationships: z
    .string()
    .describe('An explanation of the relationships between the different topics covered in the document.'),
  studyRoadmap: z
    .string()
    .describe('A string containing a recommended, numbered study roadmap for learning the material. Each step on a new line.'),
});
export type GenerateStudyMaterialsOutput = z.infer<
  typeof GenerateStudyMaterialsOutputSchema
>;

// For: generate-practice-exam.ts
export const PracticeQuestionSchema = z.object({
    questionText: z.string().describe('The text of the multiple-choice question.'),
    options: z.array(z.string()).min(4).max(4).describe('An array of exactly 4 possible answers.'),
    correctAnswer: z.string().describe('The correct answer from the options array.'),
    explanation: z.string().describe('A detailed explanation for why the answer is correct, referencing the source document.'),
});
export type PracticeQuestion = z.infer<typeof PracticeQuestionSchema>;

export const GeneratePracticeExamOutputSchema = z.object({
    questions: z.array(PracticeQuestionSchema).describe('An array of 5-10 generated practice questions.'),
});
export type GeneratePracticeExamOutput = z.infer<typeof GeneratePracticeExamOutputSchema>;
