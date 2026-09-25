/// <reference lib="webworker" />
import type { GameAnalysis, GameRecord } from '../types';
import {
  benchmark,
  buildExamples,
  datasetMeta,
  hardExamples,
  splitExamples,
  trainLite,
  weightsFromRecord,
  weightsToRecord,
  type LiteModelRecord,
} from './model';

export interface LabRequest {
  games: GameRecord[];
  analyses: GameAnalysis[];
  version: number;
  parent?: LiteModelRecord;
  epochs: number;
  engineName: string;
}

self.onmessage = (e: MessageEvent<LabRequest>) => {
  const req = e.data;
  try {
    const analyses = new Map(req.analyses.map((a) => [a.gameId, a]));
    self.postMessage({ type: 'progress', stage: 'Building dataset from KataGo analyses', value: 0.05 });
    const examples = buildExamples(req.games, analyses);
    if (examples.length < 20) throw new Error('Not enough analysed positions yet (need at least 20).');
    const meta = datasetMeta(examples, req.games, analyses, req.version);
    const { train, test } = splitExamples(examples);
    const init = req.parent ? weightsFromRecord(req.parent.weights) : undefined;
    const w = trainLite(train, {
      epochs: req.epochs,
      init,
      onEpoch: (ep, loss) =>
        self.postMessage({ type: 'progress', stage: `Training epoch ${ep + 1}/${req.epochs} (loss ${loss.toFixed(3)})`, value: 0.1 + (0.8 * (ep + 1)) / req.epochs }),
    });
    self.postMessage({ type: 'progress', stage: 'Benchmarking against KataGo', value: 0.95 });
    const bench = benchmark(w, test, req.engineName);
    const model: LiteModelRecord = {
      id: `lite-v${req.version}`,
      version: req.version,
      createdAt: Date.now(),
      datasetId: meta.id,
      datasetSize: examples.length,
      trainPositions: train.length,
      epochs: req.epochs,
      weights: weightsToRecord(w),
      benchmark: bench,
      parentId: req.parent?.id,
      notes: req.parent ? `Fine-tuned from ${req.parent.id}` : 'Trained from scratch',
    };
    const hard = hardExamples(w, examples, 40);
    self.postMessage({ type: 'done', model, dataset: meta, hard });
  } catch (err) {
    self.postMessage({ type: 'error', error: (err as Error).message });
  }
};
