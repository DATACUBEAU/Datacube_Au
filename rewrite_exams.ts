import fs from 'fs';

const path = 'src/lib/api/exams.ts';
let code = fs.readFileSync(path, 'utf8');

// Replace generatePracticeExam
code = code.replace(
  /const { data, error } = await invokeEdgeFunction<GeneratePracticeExamOutput>\('exam-generator', {[\s\S]*?}\);/g,
  `
  const ticketRes = await fetch('/api/au/vps-ticket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feature: 'generate-practice-exam' })
  });
  if (!ticketRes.ok) throw { message: 'Ticket generation failed', status: ticketRes.status };
  
  const ticketData = await ticketRes.json();
  const { ticket, vpsUrl } = ticketData.data || ticketData;

  const res = await fetch(\`\${vpsUrl}/generate/practice-exam\`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': \`Bearer \${ticket}\`,
    },
    body: JSON.stringify({
      documentContent: hasDocId ? undefined : (documentContent || undefined),
      pastQuestionsContent: hasPqIds ? undefined : (pastQuestionsContent || undefined),
      documentId: opts?.documentId || undefined,
      pastQuestionIds: hasPqIds ? opts!.pastQuestionIds : undefined,
    }),
  });

  let data, error = null;
  if (!res.ok) {
    error = { message: await res.text(), status: res.status };
  } else {
    data = await res.json();
  }
  `
);

// Replace generatePredictions
code = code.replace(
  /const { data, error } = await invokeEdgeFunction<GenerateExamPredictionsOutput>\('prediction-engine', {[\s\S]*?}\);/g,
  `
  const ticketRes = await fetch('/api/au/vps-ticket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feature: 'generate-exam-predictions' })
  });
  if (!ticketRes.ok) throw { message: 'Ticket generation failed', status: ticketRes.status };
  
  const ticketData = await ticketRes.json();
  const { ticket, vpsUrl } = ticketData.data || ticketData;

  const res = await fetch(\`\${vpsUrl}/generate/exam-predictions\`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': \`Bearer \${ticket}\`,
    },
    body: JSON.stringify({
      pastQuestionsContent: hasPqIds ? undefined : (pastQuestionsContent || undefined),
      mainTextbookContent: hasTextbookId ? undefined : (documentContent || undefined),
      documentId: opts?.documentId || opts?.mainTextbookId || undefined,
      mainTextbookId: opts?.mainTextbookId || undefined,
      pastQuestionIds: hasPqIds ? opts!.pastQuestionIds : undefined,
    }),
  });

  let data, error = null;
  if (!res.ok) {
    error = { message: await res.text(), status: res.status };
  } else {
    data = await res.json();
  }
  `
);

fs.writeFileSync(path, code);
