import fs from 'fs';

const path = 'src/hooks/use-store.ts';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(
  /const { data, error } = await invokeEdgeFunction<GenerateKnowledgeOutput>\('generate-knowledge', {[\s\S]*?}\);/g,
  `
          const ticketRes = await fetch('/api/au/vps-ticket', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ feature: 'generate-knowledge' })
          });
          if (!ticketRes.ok) throw new Error('Ticket generation failed');

          const ticketData = await ticketRes.json();
          const { ticket, vpsUrl } = ticketData.data || ticketData;

          const res = await fetch(\`\${vpsUrl}/generate/knowledge\`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': \`Bearer \${ticket}\`,
            },
            body: JSON.stringify({
              documentContent: hasDocId ? undefined : (options?.documentContent ? String(options.documentContent).slice(0, KNOWLEDGE_DOCUMENT_BUDGET) : undefined),
              pastQuestionsContent: hasPqIds ? undefined : (options?.pastQuestionsContent ? String(options.pastQuestionsContent).slice(0, KNOWLEDGE_PAST_QUESTIONS_BUDGET) : undefined),
              pastQuestionIds: hasPqIds ? options!.pastQuestionIds : undefined,
              documentId: docId,
            }),
          });

          let data, error = null;
          if (!res.ok) {
            error = { message: await res.text() };
          } else {
            data = await res.json();
          }
  `
);

fs.writeFileSync(path, code);
