import type { ClassifiedUtterance } from "./types";

/**
 * 通院カルテの「症状と経過の整理」「関係しそうな病気の候補」「出てきた薬の解説」
 * 「次の診察で先生に聞くこと」を、会話の文字起こしから作る。
 *
 * - AIもネットワークも使わず、決まった言葉を探すだけ(スマホのブラウザ内で完結する)。
 * - 病名は「候補」として、根拠になった発言と一緒に並べるだけで、1つに断定しない。
 *   候補の説明・治療・薬は一般的な情報であり、その人への診断や処方ではない。
 * - 患者ごとの病名候補を示す機能は、病院向けに配布・販売すると薬機法上の「医療機器プログラム」に
 *   当たり得るため、NEXT_PUBLIC_KARTE_CANDIDATES=off で丸ごと切れるようにしてある。
 *
 * 言葉のリストは、診察の現場で聞き取った言い回しを見ながら増やしていく前提。
 * 実際の診察記録をここ(やテスト)に書き写さないこと(個人情報のため)。
 */

export interface SymptomPattern {
  id: string;
  label: string;
  keywords: string[];
}

/** 症状・状態を表す言葉。上から順に表示する */
export const SYMPTOM_PATTERNS: SymptomPattern[] = [
  { id: "suicidal", label: "死にたい気持ち", keywords: ["死にたい", "自殺", "希死", "死ぬ方法", "消えたい"] },
  { id: "overdose", label: "薬をまとめて飲んだこと", keywords: ["大量に飲", "まとめて飲", "過量服薬", "オーバードーズ", "ODした"] },
  { id: "flashback", label: "つらい記憶がよみがえる(フラッシュバック)", keywords: ["フラッシュバック", "思い出してしまう", "急に思い出す"] },
  { id: "avoidance", label: "関係する場所や人を避ける", keywords: ["避け", "人をよけ", "近づけない", "行けなくなった"] },
  { id: "hypervigilance", label: "警戒・びくびくする", keywords: ["警戒", "びくびく", "物音に", "ビクッと"] },
  { id: "memory", label: "記憶が抜けている・曖昧", keywords: ["記憶がない", "記憶が曖昧", "記憶が戻らない", "覚えてない", "覚えていない", "記憶が飛"] },
  { id: "identity", label: "別の自分がいる感じ", keywords: ["別の人格", "もう一人の自分", "人格が"] },
  { id: "conversion", label: "歩けない・見えないなど体の機能の症状", keywords: ["歩けな", "目が見えな", "見えなくな", "車椅子", "転換症状", "声が出な", "言葉が出な"] },
  { id: "pain", label: "痛み", keywords: ["痛い", "痛み", "痛がる", "線維筋痛症", "筋痛症", "刺されてる感じ"] },
  { id: "swelling", label: "むくみ", keywords: ["むくみ", "むくん"] },
  { id: "sleep", label: "睡眠の問題(寝つき・夜中に目が覚める)", keywords: ["寝つき", "眠れない", "寝れな", "寝られな", "不眠", "目が覚め", "夜中に起き"] },
  { id: "appetite", label: "食欲", keywords: ["食欲", "食べられな", "食べれな"] },
  { id: "mood", label: "気分の落ち込み", keywords: ["落ち込", "気分が", "憂うつ", "うつ", "やる気が出な", "へこむ"] },
  { id: "anxiety", label: "不安・怖さ", keywords: ["不安", "怖い", "怖さ", "恐怖", "パニック"] },
  { id: "interpersonal", label: "人付き合いの苦手さ", keywords: ["親密になる", "人と話すのは", "顔色をうかが", "人が怖"] },
  { id: "weight", label: "体重の変化", keywords: ["太った", "体重", "痩せた", "やせた"] },
  { id: "fatigue", label: "だるさ・疲れ", keywords: ["だるい", "疲れやすい", "倦怠感"] },
  { id: "fever", label: "熱", keywords: ["熱が", "発熱", "微熱"] },
  { id: "headache", label: "頭痛", keywords: ["頭痛", "頭が痛"] },
  { id: "nausea", label: "吐き気", keywords: ["吐き気", "気持ち悪い", "吐いた"] },
  { id: "numbness", label: "しびれ", keywords: ["しびれ", "痺れ"] },
];

/** 先生と必ず共有しておきたい発言(一番上に出す) */
const IMPORTANT_SYMPTOM_IDS = new Set(["suicidal", "overdose"]);

export interface ConditionCandidate {
  id: string;
  name: string;
  about: string;
  treatment: string;
  medicines?: string;
  /** 関係する症状。minMatches 種類以上が会話に出たら候補にする */
  related: string[];
  minMatches: number;
  /** このうち1つ以上が出ていないと候補にしない症状(例: 歩けない症状が無いのに転換症状の候補は出さない) */
  required?: string[];
  /** 会話にこの言葉そのものが出たら候補にする(症状の数が足りなくても) */
  explicitWords?: string[];
  questions: string[];
}

export const CONDITION_CANDIDATES: ConditionCandidate[] = [
  {
    id: "ptsd",
    name: "PTSD(心的外傷後ストレス障害)",
    about: "強い恐怖の体験のあと、心が「危険モード」のまま戻れなくなる状態。",
    treatment: "安全な場で少しずつ記憶を整理していく専門のカウンセリング(持続エクスポージャー療法・認知処理療法・EMDRなど)が中心。",
    medicines: "SSRIという抗うつ薬がよく使われる。日本でPTSDに使える薬として認められているのはパロキセチン(パキシル)とセルトラリン(ジェイゾロフト)。",
    related: ["flashback", "avoidance", "hypervigilance", "sleep", "anxiety", "memory"],
    minMatches: 2,
    required: ["flashback", "avoidance", "hypervigilance"],
    explicitWords: ["PTSD", "心的外傷", "トラウマ"],
    questions: [
      "診断名は何ですか(PTSDなどに当たりますか)",
      "カウンセリング(トラウマの治療)は受けられますか。どのくらいの頻度ですか",
    ],
  },
  {
    id: "dissociation",
    name: "解離(解離性障害)",
    about: "つらすぎる体験から心を守るために、記憶や感覚が切り離される反応。",
    treatment: "安心できる環境づくりとカウンセリングが中心。解離そのものに効く専用の薬はない。",
    related: ["memory", "identity", "flashback"],
    minMatches: 2,
    required: ["memory", "identity"],
    explicitWords: ["解離"],
    questions: ["記憶が抜けているとき、家族はどう接すればよいですか"],
  },
  {
    id: "conversion",
    name: "機能性神経症状症(転換症状)",
    about: "体のつくりに異常はないのに、心の負担が「歩けない」「見えない」などの体の症状として出る状態。気のせいや仮病ではない。",
    treatment: "病気の仕組みの説明、リハビリ、カウンセリングを組み合わせる。",
    related: ["conversion", "flashback", "anxiety", "mood", "memory"],
    minMatches: 2,
    required: ["conversion"],
    explicitWords: ["転換症状", "転換性", "変換症", "機能性神経"],
    questions: ["歩けない(見えない)症状は、リハビリなどで良くなりますか"],
  },
  {
    id: "depression",
    name: "うつ状態",
    about: "気分の落ち込みに加えて、眠り・食欲・意欲などがまとめて落ちる状態。",
    treatment: "休養・カウンセリング・抗うつ薬などを組み合わせる。",
    medicines: "SSRI・SNRI・NaSSAなどの抗うつ薬が使われることが多い。",
    related: ["mood", "sleep", "appetite", "suicidal", "fatigue"],
    minMatches: 2,
    required: ["mood", "suicidal"],
    explicitWords: ["うつ病", "抑うつ"],
    questions: ["眠りや食欲が戻らないときは、どうすればよいですか"],
  },
  {
    id: "fibromyalgia",
    name: "線維筋痛症",
    about: "体のあちこちに強い痛みが続く病気。痛みを感じる神経が過敏になっていると考えられている。",
    treatment: "薬と、無理のない運動・生活の工夫を組み合わせる。",
    medicines: "プレガバリン(リリカ)、デュロキセチン(サインバルタ)など。",
    related: [],
    minMatches: Number.POSITIVE_INFINITY,
    explicitWords: ["線維筋痛症", "筋痛症"],
    questions: ["今の痛みやむくみの治療は、どこ(どの科)で続ければよいですか"],
  },
];

export interface DrugInfo {
  names: string[];
  label: string;
  about: string;
}

/** 薬の名前(商品名・一般名)と、どんな薬か(一般的な説明) */
export const DRUG_GLOSSARY: DrugInfo[] = [
  { names: ["パキシル", "パロキセチン"], label: "パロキセチン(パキシル)", about: "SSRIという抗うつ薬。うつ病・不安・PTSDなどに使われる。" },
  { names: ["ジェイゾロフト", "セルトラリン"], label: "セルトラリン(ジェイゾロフト)", about: "SSRIという抗うつ薬。うつ病・パニック障害・PTSDなどに使われる。" },
  { names: ["レクサプロ", "エスシタロプラム"], label: "エスシタロプラム(レクサプロ)", about: "SSRIという抗うつ薬。うつ病・社交不安などに使われる。" },
  { names: ["サインバルタ", "デュロキセチン"], label: "デュロキセチン(サインバルタ)", about: "SNRIという抗うつ薬。うつ病のほか、線維筋痛症などの痛みにも使われる。" },
  { names: ["リリカ", "プレガバリン"], label: "プレガバリン(リリカ)", about: "神経の痛みを和らげる薬。線維筋痛症にも使われる。眠気・めまいが出ることがある。" },
  { names: ["タリージェ", "ミロガバリン"], label: "ミロガバリン(タリージェ)", about: "神経の痛みを和らげる薬。眠気・めまいが出ることがある。" },
  { names: ["リフレックス", "レメロン", "ミルタザピン"], label: "ミルタザピン(リフレックス/レメロン)", about: "NaSSAという抗うつ薬。眠気が出やすく、眠れないときに使われることもある。" },
  { names: ["トラゾドン", "デジレル", "レスリン"], label: "トラゾドン(デジレル/レスリン)", about: "抗うつ薬。少量で睡眠を助ける目的で使われることもある。" },
  { names: ["デパス", "エチゾラム"], label: "エチゾラム(デパス)", about: "抗不安薬(ベンゾジアゼピン系)。続けて飲むと癖になりやすいので、量と期間は先生と相談する。" },
  { names: ["ソラナックス", "コンスタン", "アルプラゾラム"], label: "アルプラゾラム(ソラナックス/コンスタン)", about: "抗不安薬(ベンゾジアゼピン系)。続けて飲むと癖になりやすい。" },
  { names: ["ワイパックス", "ロラゼパム"], label: "ロラゼパム(ワイパックス)", about: "抗不安薬(ベンゾジアゼピン系)。続けて飲むと癖になりやすい。" },
  { names: ["マイスリー", "ゾルピデム"], label: "ゾルピデム(マイスリー)", about: "睡眠薬。寝つきをよくする。" },
  { names: ["ルネスタ", "エスゾピクロン"], label: "エスゾピクロン(ルネスタ)", about: "睡眠薬。口の中に苦みが残ることがある。" },
  { names: ["デエビゴ", "レンボレキサント"], label: "レンボレキサント(デエビゴ)", about: "睡眠薬(オレキシン受容体拮抗薬)。比較的癖になりにくいとされる。" },
  { names: ["ベルソムラ", "スボレキサント"], label: "スボレキサント(ベルソムラ)", about: "睡眠薬(オレキシン受容体拮抗薬)。比較的癖になりにくいとされる。" },
  { names: ["ロゼレム", "ラメルテオン"], label: "ラメルテオン(ロゼレム)", about: "睡眠のリズムを整える薬。" },
  { names: ["エビリファイ", "アリピプラゾール"], label: "アリピプラゾール(エビリファイ)", about: "抗精神病薬。少量で気分の安定などに使われることもある。" },
  { names: ["セロクエル", "クエチアピン"], label: "クエチアピン(セロクエル)", about: "抗精神病薬。少量で睡眠や気分の安定などに使われることもある。" },
  { names: ["抑肝散"], label: "抑肝散(漢方)", about: "イライラや興奮を和らげる目的で使われる漢方薬。" },
];

const GENERAL_QUESTIONS = [
  "出された薬は、何のための薬ですか。いつまで飲みますか",
  "副作用で気をつけることはありますか",
  "次の予約はいつですか。それまでに具合が悪くなったら、どこに連絡すればよいですか",
];

const SAFETY_QUESTIONS = ["薬は家族が預かって管理した方がよいですか(1回に出す日数を短くできますか)"];

export interface SymptomFinding {
  pattern: SymptomPattern;
  evidence: ClassifiedUtterance[];
}

export interface CandidateFinding {
  candidate: ConditionCandidate;
  matchedSymptoms: SymptomPattern[];
  explicitEvidence: ClassifiedUtterance[];
}

export interface KarteInsights {
  important: SymptomFinding[];
  symptoms: SymptomFinding[];
  candidates: CandidateFinding[];
  drugs: Array<{ drug: DrugInfo; evidence: ClassifiedUtterance[] }>;
  questions: string[];
}

/**
 * 音声認識が同じ発言を少しずつ伸ばしながら何度も確定させた分(「〜いら」「〜いらしい」…)を、
 * 一番長いもの1つにまとめる。保存データは変えず、表示用に間引くだけ。
 */
export function collapseGrowingUtterances(utterances: ClassifiedUtterance[]): ClassifiedUtterance[] {
  const result: ClassifiedUtterance[] = [];
  for (const u of utterances) {
    const text = u.text.trim();
    const prev = result[result.length - 1];
    if (prev) {
      const prevText = prev.text.trim();
      const close = Math.abs(u.timestamp - prev.timestamp) < 60_000;
      if (close && (text === prevText || text.startsWith(prevText))) {
        result[result.length - 1] = u;
        continue;
      }
      if (close && prevText.startsWith(text)) continue;
    }
    result.push(u);
  }
  return result;
}

function includesAny(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

export function findSymptoms(utterances: ClassifiedUtterance[]): SymptomFinding[] {
  const findings: SymptomFinding[] = [];
  for (const pattern of SYMPTOM_PATTERNS) {
    const evidence = utterances.filter((u) => includesAny(u.text, pattern.keywords));
    if (evidence.length > 0) findings.push({ pattern, evidence });
  }
  return findings;
}

export function analyzeKarte(
  rawUtterances: ClassifiedUtterance[],
  options: { includeCandidates?: boolean } = {}
): KarteInsights {
  const includeCandidates = options.includeCandidates ?? true;
  const utterances = collapseGrowingUtterances(rawUtterances);
  const allSymptoms = findSymptoms(utterances);
  const foundIds = new Set(allSymptoms.map((f) => f.pattern.id));

  const important = allSymptoms.filter((f) => IMPORTANT_SYMPTOM_IDS.has(f.pattern.id));
  const symptoms = allSymptoms.filter((f) => !IMPORTANT_SYMPTOM_IDS.has(f.pattern.id));

  const candidates: CandidateFinding[] = [];
  if (includeCandidates) {
    for (const candidate of CONDITION_CANDIDATES) {
      const matchedSymptoms = SYMPTOM_PATTERNS.filter(
        (p) => candidate.related.includes(p.id) && foundIds.has(p.id)
      );
      const explicitEvidence = candidate.explicitWords
        ? utterances.filter((u) => includesAny(u.text, candidate.explicitWords!))
        : [];
      const hasRequired = !candidate.required || candidate.required.some((id) => foundIds.has(id));
      const bySymptoms = hasRequired && matchedSymptoms.length >= candidate.minMatches;
      if (bySymptoms || explicitEvidence.length > 0) {
        candidates.push({ candidate, matchedSymptoms, explicitEvidence });
      }
    }
  }

  const drugs = DRUG_GLOSSARY.map((drug) => ({
    drug,
    evidence: utterances.filter((u) => includesAny(u.text, drug.names)),
  })).filter((d) => d.evidence.length > 0);

  const questions = [
    ...(important.length > 0 ? SAFETY_QUESTIONS : []),
    ...candidates.flatMap((c) => c.candidate.questions),
    ...GENERAL_QUESTIONS,
  ];

  return { important, symptoms, candidates, drugs, questions };
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

const MAX_QUOTES = 3;
const MAX_QUOTE_LENGTH = 50;

function quote(u: ClassifiedUtterance): string {
  const text = u.text.trim();
  const short = text.length > MAX_QUOTE_LENGTH ? `${text.slice(0, MAX_QUOTE_LENGTH)}…` : text;
  return `「${short}」(${formatTime(u.timestamp)})`;
}

function quotes(evidence: ClassifiedUtterance[]): string {
  const shown = evidence.slice(0, MAX_QUOTES).map(quote).join(" ");
  const rest = evidence.length - MAX_QUOTES;
  return rest > 0 ? `${shown} ほか${rest}件` : shown;
}

/** 通院カルテのMarkdownに差し込む見出し付きの節(## 見出し / - 項目)を返す */
export function karteInsightsMarkdown(insights: KarteInsights): string[] {
  const lines: string[] = [];

  if (insights.important.length > 0) {
    lines.push("## 先生と必ず共有しておきたいこと");
    insights.important.forEach((f) => lines.push(`- ${f.pattern.label}:${quotes(f.evidence)}`));
    lines.push("");
  }

  lines.push("## 症状と経過の整理");
  if (insights.symptoms.length === 0) {
    lines.push("- (症状に関する言葉は見つかりませんでした)");
  } else {
    lines.push("- ※会話に出てきた言葉を拾ったものです。先生からの質問の言葉も含まれます。");
    insights.symptoms.forEach((f) => lines.push(`- ${f.pattern.label}:${quotes(f.evidence)}`));
  }
  lines.push("");

  if (insights.candidates.length > 0) {
    lines.push("## 参考:関係しそうな病気の候補(診断ではありません)");
    lines.push("- ※会話に出た言葉から機械的に挙げた「候補」です。病名を決めるのは先生です。次の診察で確認してください。");
    for (const { candidate, matchedSymptoms, explicitEvidence } of insights.candidates) {
      const grounds = [
        ...matchedSymptoms.map((s) => s.label),
        ...(explicitEvidence.length > 0 ? [`会話に「${candidate.explicitWords!.find((w) => explicitEvidence.some((u) => u.text.includes(w)))}」という言葉`] : []),
      ];
      lines.push(`- 【${candidate.name}】根拠:${grounds.join("、")}`);
      lines.push(`- 【${candidate.name}】どんな状態か:${candidate.about}`);
      lines.push(`- 【${candidate.name}】一般的な治療:${candidate.treatment}`);
      if (candidate.medicines) lines.push(`- 【${candidate.name}】よく使われる薬:${candidate.medicines}`);
    }
    lines.push("");
  }

  if (insights.drugs.length > 0) {
    lines.push("## 出てきた薬の解説(一般的な説明)");
    insights.drugs.forEach(({ drug, evidence }) =>
      lines.push(`- ${drug.label}:${drug.about} ${quotes(evidence)}`)
    );
    lines.push("");
  }

  lines.push("## 次の診察で先生に聞くこと");
  insights.questions.forEach((q) => lines.push(`- [ ] ${q}`));
  lines.push("");

  return lines;
}

/** NEXT_PUBLIC_KARTE_CANDIDATES=off で、病名候補(と候補に基づく質問)を出さない */
export function candidatesEnabled(): boolean {
  const value = (process.env.NEXT_PUBLIC_KARTE_CANDIDATES ?? "on").toLowerCase();
  return !["off", "false", "0", "no"].includes(value);
}
