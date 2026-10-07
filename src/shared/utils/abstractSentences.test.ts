import { describe, expect, it } from "vitest";
import {
  findConfirmedEvidenceIndices,
  resolveKeyPointEvidence,
  splitAbstractSentences,
} from "./abstractSentences";

describe("splitAbstractSentences", () => {
  it("正常系: 文末の「. 」で区切り、改行や連続する空白は1つの空白にする", () => {
    expect(
      splitAbstractSentences("We propose X.  It works\nwell! Does it scale? Yes, to 10B params.")
    ).toEqual(["We propose X.", "It works well!", "Does it scale?", "Yes, to 10B params."]);
  });

  it("正常系: 小数点・略語・小文字で続く文では区切らない", () => {
    expect(
      splitAbstractSentences(
        "Accuracy rises from 3.5 to 4.2 points, e.g. on GLUE. Smith et al. Showed it. Results vs. baselines hold."
      )
    ).toEqual([
      "Accuracy rises from 3.5 to 4.2 points, e.g. on GLUE.",
      "Smith et al. Showed it.",
      "Results vs. baselines hold.",
    ]);
  });

  it('正常系: 括弧内の略語（"(Fig. 2)" "[e.g. X]"）でも区切らない', () => {
    expect(
      splitAbstractSentences("Results improve (Fig. 2) and [e.g. Table 3] hold. Next sentence.")
    ).toEqual(["Results improve (Fig. 2) and [e.g. Table 3] hold.", "Next sentence."]);
  });

  it('正常系: 語の末尾が略語と同じ綴り（"piano." の "no."）でも略語とみなさない', () => {
    expect(splitAbstractSentences("We play the piano. It works.")).toEqual([
      "We play the piano.",
      "It works.",
    ]);
  });

  it("性能: 入力を8倍にしても処理時間の伸びは線形の範囲に収まる（二乗時間なら約64倍になる）", () => {
    // 絶対時間はマシンの性能・負荷で変わるため、同じ条件で測った小さい入力と大きい入力の時間の比で判定する
    const smallSize = 25_000;
    const scale = 8;
    const sentence = "Accuracy improves by 3.5 points (Fig. 2), e.g. on GLUE vs. baselines. ";
    const patterns: ((size: number) => string)[] = [
      (size) => sentence.repeat(Math.ceil(size / sentence.length)),
      // 終止符がない入力
      (size) => "a".repeat(size),
      // 終止符だけが続く入力
      (size) => ". ".repeat(size / 2),
      // 略語が続いて文が終わらない入力（文の先頭から走査し直すと二乗時間になる）
      (size) => "e.g. X ".repeat(Math.ceil(size / 7)),
    ];
    // 経過時間は他のプロセスに CPU を奪われた時間を含んで大きく揺れるため、このプロセスの CPU 時間（ms）で測る。
    // process.cpuUsage() はプロセス全体の値なので、テストファイルごとに別プロセスで動く pool（forks、vitest 4 の既定）を前提にする。
    // pool を threads に変えると他のテストファイルの CPU 時間も含まれるため、この測り方を見直すこと
    const measure = (input: string) => {
      const startedAt = process.cpuUsage();
      splitAbstractSentences(input);
      const { user, system } = process.cpuUsage(startedAt);
      return (user + system) / 1000;
    };

    for (const pattern of patterns) {
      const small = pattern(smallSize);
      const large = pattern(smallSize * scale);
      // JIT の最適化前の時間を含めないよう、計測前に両方を一度実行する
      // 大きい入力が1回で 500ms を超えるなら、その時点で二乗時間とみなして失敗させる
      // （線形なら数十ms。5回の計測を続けてテストのタイムアウトで落ちるのを避ける）
      measure(small);
      expect(measure(large)).toBeLessThan(500);
      // 他の処理による一時的な遅れを除くため、交互に5回ずつ測ってそれぞれ最短の時間を使う
      let smallElapsed = Number.POSITIVE_INFINITY;
      let largeElapsed = Number.POSITIVE_INFINITY;
      for (let round = 0; round < 5; round++) {
        smallElapsed = Math.min(smallElapsed, measure(small));
        largeElapsed = Math.min(largeElapsed, measure(large));
      }
      // 線形なら約8倍、二乗なら約64倍。負荷の揺らぎを見込んで線形の3倍（24倍）を上限にする
      expect(largeElapsed / Math.max(smallElapsed, 0.01)).toBeLessThan(scale * 3);
    }
    const largeSize = smallSize * scale;
    const sentenceCount = Math.ceil(largeSize / sentence.length);
    expect(splitAbstractSentences(sentence.repeat(sentenceCount))).toHaveLength(sentenceCount);
    expect(splitAbstractSentences("e.g. X ".repeat(Math.ceil(largeSize / 7)))).toHaveLength(1);
  });

  it("正常系: 全角の終止符で区切る", () => {
    expect(splitAbstractSentences("手法を提案する。精度が向上した！")).toEqual([
      "手法を提案する。",
      "精度が向上した！",
    ]);
  });

  it("正常系: 同じ入力には常に同じ結果を返し、空の Abstract は空配列", () => {
    const abstract = "First. Second.";
    expect(splitAbstractSentences(abstract)).toEqual(splitAbstractSentences(abstract));
    expect(splitAbstractSentences("   ")).toEqual([]);
  });
});

describe("resolveKeyPointEvidence", () => {
  const sentences = ["First.", "Second.", "Third."];

  it("正常系: 文番号を Abstract の文に解決し、キーポイントと同じ長さ・順序で返す", () => {
    expect(resolveKeyPointEvidence(sentences, 3, [[0], [1, 2], []])).toEqual([
      [{ index: 0, text: "First." }],
      [
        { index: 1, text: "Second." },
        { index: 2, text: "Third." },
      ],
      [],
    ]);
  });

  it("異常系: 実在しない番号（範囲外・負数・小数・重複・数値以外）は捨て、残らなければ未確認（空配列）", () => {
    expect(resolveKeyPointEvidence(sentences, 3, [[3, -1, 0.5], [1, 1, "2"], [99]])).toEqual([
      [],
      [{ index: 1, text: "Second." }],
      [],
    ]);
  });

  it("異常系: 根拠が返らない・キーポイントより少ない場合は、足りない分を未確認（空配列）にする", () => {
    expect(resolveKeyPointEvidence(sentences, 2, undefined)).toEqual([[], []]);
    expect(resolveKeyPointEvidence(sentences, 2, [[0]])).toEqual([
      [{ index: 0, text: "First." }],
      [],
    ]);
  });
});

describe("findConfirmedEvidenceIndices", () => {
  const sentences = ["First.", "Second."];

  it("正常系: 表示中の Abstract の同じ番号に同じ文がある根拠だけを返す", () => {
    expect(
      findConfirmedEvidenceIndices(sentences, [
        { index: 1, text: "Second." },
        { index: 0, text: "Changed." },
        { index: 5, text: "First." },
      ])
    ).toEqual([1]);
  });

  it("正常系: 根拠のない古い要約は空配列（未確認）", () => {
    expect(findConfirmedEvidenceIndices(sentences, undefined)).toEqual([]);
  });
});
