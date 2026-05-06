import fs from 'fs';

const p = 'vps-ai-gateway/src/generation-handler.ts';
let code = fs.readFileSync(p, 'utf8');

// Add hydration helpers
const hydrationHelpers = `
  private async hydrateDocumentContent(documentId: string, userId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('au_documents')
      .select('content_text')
      .eq('id', documentId)
      .eq('user_id', userId)
      .single();
    return data?.content_text || null;
  }

  private async hydratePastQuestions(pastQuestionIds: string[], userId: string): Promise<string | null> {
    if (!pastQuestionIds || pastQuestionIds.length === 0) return null;
    const { data } = await this.supabase
      .from('au_past_questions')
      .select('question, answer')
      .in('id', pastQuestionIds)
      .eq('user_id', userId);
    
    if (!data || data.length === 0) return null;
    return data.map(q => \`Q: \${q.question}\\nA: \${q.answer}\`).join('\\n\\n');
  }

  private async selectModel(`;

code = code.replace('  private async selectModel(', hydrationHelpers);

// Update handleKnowledge
code = code.replace(
  `    const { documentId, documentContent, pastQuestionsContent } = body;

    if (!documentContent) {`,
  `    const { documentId } = body;
    let { documentContent, pastQuestionsContent } = body;

    if (!documentContent && documentId) {
      documentContent = await this.hydrateDocumentContent(documentId, userId);
    }
    if (!pastQuestionsContent && body.pastQuestionIds) {
      pastQuestionsContent = await this.hydratePastQuestions(body.pastQuestionIds, userId);
    }

    if (!documentContent) {`
);

// Update handleExamPredictions
code = code.replace(
  `    const { mainTextbookId, mainTextbookContent, pastQuestionsContent } = body;

    if (!mainTextbookContent) {`,
  `    const { mainTextbookId } = body;
    let { mainTextbookContent, pastQuestionsContent } = body;

    if (!mainTextbookContent && mainTextbookId) {
      mainTextbookContent = await this.hydrateDocumentContent(mainTextbookId, userId);
    }
    if (!pastQuestionsContent && body.pastQuestionIds) {
      pastQuestionsContent = await this.hydratePastQuestions(body.pastQuestionIds, userId);
    }

    if (!mainTextbookContent) {`
);

// Update handlePracticeExam
code = code.replace(
  `    const { documentId, documentContent, pastQuestionsContent } = body;

    if (!documentContent) {`,
  `    const { documentId } = body;
    let { documentContent, pastQuestionsContent } = body;

    if (!documentContent && documentId) {
      documentContent = await this.hydrateDocumentContent(documentId, userId);
    }
    if (!pastQuestionsContent && body.pastQuestionIds) {
      pastQuestionsContent = await this.hydratePastQuestions(body.pastQuestionIds, userId);
    }

    if (!documentContent) {`
);

fs.writeFileSync(p, code);
