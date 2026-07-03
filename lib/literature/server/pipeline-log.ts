// Server-only module.

export function logLiteraturePipelineCounts(counts: {
  totalFetched: number;
  afterDedup: number;
  afterRanking: number;
  sentToAi: number;
  finalReturned: number;
}): void {
  console.log(
    `[literature] pipeline: totalFetched=${counts.totalFetched} afterDedup=${counts.afterDedup} afterRanking=${counts.afterRanking} sentToAi=${counts.sentToAi} finalReturned=${counts.finalReturned}`,
  );
}
