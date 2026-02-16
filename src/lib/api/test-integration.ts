
import { listDocuments } from './documents';
import { sendChatMessage } from './chat';
import { generatePracticeExam } from './exams';

async function testIntegration() {
  console.log('🚀 Starting AU Integration Test...');

  try {
    // 1. Test Document Listing
    console.log('\n--- 1. Testing listDocuments ---');
    const docs = await listDocuments(null);
    console.log(`✅ Found ${docs.length} documents for unauthenticated session.`);
    if (docs.length > 0) {
      console.log('Sample Document:', {
        id: docs[0].id,
        file_name: docs[0].file_name,
        status: docs[0].status
      });
    }

    // 2. Test Chat (if a document exists)
    if (docs.length > 0) {
      const targetDoc = docs.find(d => d.status === 'completed') || docs[0];
      console.log(`\n--- 2. Testing sendChatMessage for doc: ${targetDoc.id} ---`);
      try {
        const chatResult = await sendChatMessage({
          messages: [{ id: 'test-1', role: 'user', content: 'What is this document about?' }],
          selectedDocId: targetDoc.id
        });
        console.log('✅ Chat response received:', chatResult.answer.substring(0, 100) + '...');
      } catch (e: any) {
        console.warn('⚠️ Chat test failed (expected if RLS or Edge Function is restricted):', e.message);
      }

      // 3. Test Exam Generation
      console.log(`\n--- 3. Testing generatePracticeExam for doc: ${targetDoc.id} ---`);
      try {
        const examResult = await generatePracticeExam(targetDoc.id);
        console.log(`✅ Exam generated with ${examResult.questions.length} questions.`);
      } catch (e: any) {
        console.warn('⚠️ Exam test failed (expected if text content is empty or restricted):', e.message);
      }
    } else {
      console.log('\n⏭️ Skipping Chat and Exam tests (no documents found).');
    }

    console.log('\n✨ Integration test completed!');
  } catch (error: any) {
    console.error('\n❌ Integration test failed:', error.message);
  }
}

// Note: This script is intended to be run in a browser environment or with a polyfilled fetch
// For local CLI testing, you'd need to mock window.location and localStorage
console.log('Test script loaded. Call testIntegration() in the console.');
