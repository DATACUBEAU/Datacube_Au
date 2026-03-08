"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isActiveStatus = isActiveStatus;
exports.isTerminalStatus = isTerminalStatus;
exports.reconcileJobsWithDocumentRows = reconcileJobsWithDocumentRows;
function isActiveStatus(status) {
    return status === 'queued' || status === 'uploading' || status === 'uploaded' || status === 'processing';
}
function isTerminalStatus(status) {
    return status === 'failed' || status === 'cancelled' || status === 'done' || status === 'completed' || status === 'stale_timeout';
}
function reconcileJobsWithDocumentRows(jobs, documentRows) {
    if (jobs.length === 0)
        return jobs;
    const docMap = new Map();
    for (const row of documentRows) {
        if (!row?.id)
            continue;
        docMap.set(String(row.id), row);
    }
    return jobs.map((job) => {
        const doc = docMap.get(job.document_id);
        if (!doc)
            return job;
        const docStatus = String(doc.status || '').toLowerCase();
        const docTimestamp = typeof doc.created_at === 'string' ? doc.created_at : job.updated_at;
        if (docStatus === 'failed') {
            return {
                ...job,
                status: 'failed',
                error: (typeof doc.error === 'string' && doc.error) || job.error || 'Document processing failed.',
                updated_at: docTimestamp,
            };
        }
        if (docStatus === 'completed' || docStatus === 'done' || docStatus === 'indexed') {
            return {
                ...job,
                status: 'done',
                progress: 100,
                error: null,
                updated_at: docTimestamp,
            };
        }
        if (docStatus === 'processing' || docStatus === 'uploaded') {
            return {
                ...job,
                status: 'processing',
                progress: Math.max(job.progress || 0, 92),
                updated_at: docTimestamp,
            };
        }
        return job;
    });
}
