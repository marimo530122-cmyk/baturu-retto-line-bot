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
  { id: "pain", label: "痛み", keywords: ["痛い", "痛み", "痛くて", "痛む", "痛かった", "痛がる", "線維筋痛症", "筋痛症", "刺されてる感じ"] },
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

/** 先生のフィードバックで決めた「5項目まとめ」の1項目 */
export interface SummaryItem {
  id: "overview" | "condition" | "treatment" | "progress" | "plan";
  label: string;
  /** 自動で作った説明文(拾った言葉から組み立てる) */
  lead: string[];
  /** 根拠になった発言 */
  evidence: ClassifiedUtterance[];
}

/** 一番上に出す「要点」(家族が通院のあとに見返す用。短い言葉だけで、発言の引用は入れない) */
export interface KeyPointSection {
  heading: string;
  items: string[];
}

/** 症状を「命の安全・体・心・背景の体験」に分けた短い呼び名(要点とフィッシュボーンで使う) */
export interface SymptomGroups {
  safety: string[];
  body: string[];
  mind: string[];
  hardships: string[];
}

export interface KarteInsights {
  groups: SymptomGroups;
  keyPoints: KeyPointSection[];
  summary: SummaryItem[];
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

// 5項目まとめで、どの発言をどの項目に入れるかの目印になる言葉
const CONDITION_WORDS = ["診断", "病名", "と考えられ", "可能性", "疑い", "症状が出て", "状態です", "障害", "病気"];
const TREATMENT_WORDS = ["処方", "薬", "飲んで", "服用", "カウンセリング", "治療", "リハビリ", "入院", "注射", "点滴", "療法"];
const PROGRESS_WORDS = ["前回", "以前より", "前より", "良くなっ", "よくなっ", "悪くなっ", "変わらな", "変わりな", "様子を見", "経過", "続いて", "ここ最近", "だいぶ", "落ち着い"];
const PLAN_WORDS = ["次回", "予約", "今後", "これから", "来週", "来月", "週間後", "ヶ月後", "か月後", "カ月後", "検査を", "紹介", "続けて", "しましょう", "していきましょう"];

/** 相づちや言いかけ(「はい」「えーと」等)は要約に入れない */
const MIN_SUMMARY_TEXT_LENGTH = 8;
const MAX_SUMMARY_EVIDENCE = 5;

function pick(utterances: ClassifiedUtterance[], words: string[]): ClassifiedUtterance[] {
  return utterances.filter((u) => u.text.trim().length >= MIN_SUMMARY_TEXT_LENGTH && includesAny(u.text, words));
}

function buildSummary(
  utterances: ClassifiedUtterance[],
  symptoms: SymptomFinding[],
  important: SymptomFinding[],
  candidates: CandidateFinding[],
  drugs: KarteInsights["drugs"]
): SummaryItem[] {
  const first = utterances[0];
  const last = utterances[utterances.length - 1];
  const minutes = first && last ? Math.max(1, Math.round((last.timestamp - first.timestamp) / 60_000)) : 0;
  const symptomLabels = [...important, ...symptoms].map((f) => f.pattern.label);

  const overview: SummaryItem = {
    id: "overview",
    label: "① 概要",
    lead: [
      first ? `記録 ${formatTime(first.timestamp)}〜${formatTime(last.timestamp)}(約${minutes}分・発言${utterances.length}件)` : "まだ記録がありません",
      symptomLabels.length > 0 ? `話題になった症状:${symptomLabels.join("、")}` : "症状に関する言葉は見つかりませんでした",
    ],
    evidence: [],
  };

  const conditionEvidence = pick(utterances, CONDITION_WORDS);
  const condition: SummaryItem = {
    id: "condition",
    label: "② 今どういう病気か",
    lead: [
      conditionEvidence.length > 0
        ? "診断・病状について話された部分です。病名は先生の言葉で確認してください。"
        : "病名についての発言は見つかりませんでした。次の診察で先生に確認しましょう。",
      ...(candidates.length > 0 ? [`参考の候補(診断ではありません):${candidates.map((c) => c.candidate.name).join("、")}`] : []),
    ],
    evidence: conditionEvidence,
  };

  // 「薬を大量に飲んだ」等は治療方針ではなく、一番上の「先生と必ず共有しておきたいこと」に出す
  const overdoseWords = SYMPTOM_PATTERNS.find((p) => p.id === "overdose")?.keywords ?? [];
  const treatmentEvidence = pick(utterances, [...TREATMENT_WORDS, ...drugs.flatMap((d) => d.drug.names)]).filter(
    (u) => !includesAny(u.text, overdoseWords)
  );
  const treatment: SummaryItem = {
    id: "treatment",
    label: "③ 治療方針(今の治療・薬)",
    lead: [
      ...(drugs.length > 0 ? [`会話に出た薬:${drugs.map((d) => d.drug.label).join("、")}`] : []),
      ...(treatmentEvidence.length === 0 ? ["治療や薬についての発言は見つかりませんでした。"] : []),
    ],
    evidence: treatmentEvidence,
  };

  const progressEvidence = pick(utterances, PROGRESS_WORDS);
  const progress: SummaryItem = {
    id: "progress",
    label: "④ 経過観察(これまでの経過・様子を見ること)",
    lead: progressEvidence.length === 0 ? ["経過についての発言は見つかりませんでした。"] : [],
    evidence: progressEvidence,
  };

  const planEvidence = pick(utterances, PLAN_WORDS);
  const plan: SummaryItem = {
    id: "plan",
    label: "⑤ 今後の方針(次回の予定・これからの治療)",
    lead: planEvidence.length === 0 ? ["今後の予定についての発言は見つかりませんでした。次回の予約を確認しましょう。"] : [],
    evidence: planEvidence,
  };

  return [overview, condition, treatment, progress, plan];
}

// 「要点」で使う短い呼び名と、体/心のどちらの症状としてまとめるか
const SHORT_NAME: Record<string, string> = {
  suicidal: "死にたい気持ち",
  overdose: "過量服薬(薬をまとめて飲んだこと)",
  flashback: "フラッシュバック",
  avoidance: "関係する場所を避ける",
  hypervigilance: "警戒",
  memory: "記憶の抜け",
  identity: "別の自分がいる感覚",
  conversion: "歩けない・見えない等",
  pain: "痛み",
  swelling: "むくみ",
  sleep: "不眠",
  appetite: "食欲の変化",
  mood: "気分の落ち込み",
  anxiety: "不安・恐怖",
  interpersonal: "対人関係の苦手さ",
  weight: "体重の変化",
  fatigue: "だるさ",
  fever: "熱",
  headache: "頭痛",
  nausea: "吐き気",
  numbness: "しびれ",
};
const BODY_SYMPTOM_IDS = ["pain", "conversion", "swelling", "sleep", "appetite", "weight", "fatigue", "fever", "headache", "nausea", "numbness"];
const MIND_SYMPTOM_IDS = ["flashback", "avoidance", "hypervigilance", "memory", "identity", "mood", "anxiety", "interpersonal"];

/** 背景にあるつらい体験の話題(要点には言葉の種類だけ出し、発言そのものは引用しない) */
const HARDSHIP_TOPICS: Array<{ label: string; keywords: string[] }> = [
  { label: "事故", keywords: ["事故"] },
  { label: "身近な人の死", keywords: ["亡くな", "死んじゃ", "死にました"] },
  { label: "流産", keywords: ["流産"] },
  { label: "暴力・DV", keywords: ["暴力", "DV", "殴"] },
  { label: "性的な被害", keywords: ["性的", "強姦", "犯され"] },
  { label: "虐待", keywords: ["虐待"] },
  { label: "いじめ", keywords: ["いじめ"] },
  { label: "家族の問題", keywords: ["離婚", "家族の問題", "親との関係"] },
];

const TRAUMA_CANDIDATE_IDS = new Set(["ptsd", "dissociation", "conversion"]);

function shortNames(ids: string[], found: Set<string>): string[] {
  return ids.filter((id) => found.has(id)).map((id) => SHORT_NAME[id]);
}

function buildKeyPoints(
  utterances: ClassifiedUtterance[],
  foundIds: Set<string>,
  candidates: CandidateFinding[],
  drugs: KarteInsights["drugs"],
  hasTreatmentTalk: boolean
): KeyPointSection[] {
  const sections: KeyPointSection[] = [];

  // 1. 重要ポイント
  const important: string[] = [];
  const safety = shortNames(["suicidal", "overdose"], foundIds);
  if (safety.length > 0) important.push(`命の安全(最優先):${safety.join("・")}の発言あり`);
  const body = shortNames(BODY_SYMPTOM_IDS, foundIds);
  if (body.length > 0) important.push(`体の症状:${body.join("、")}`);
  const mind = shortNames(MIND_SYMPTOM_IDS, foundIds);
  if (mind.length > 0) important.push(`心・トラウマの症状:${mind.join("、")}`);
  const hardships = HARDSHIP_TOPICS.filter((t) => utterances.some((u) => includesAny(u.text, t.keywords))).map((t) => t.label);
  if (hardships.length > 0) important.push(`背景にあるつらい体験の話題:${hardships.join("、")}`);
  if (important.length === 0) important.push("症状に関する言葉は見つかりませんでした");
  sections.push({ heading: "1. 診察の重要ポイント", items: important });

  // 2. 処方の確認
  const prescription: string[] = [];
  if (safety.length > 0) {
    prescription.push("日数と管理:過量服薬を防ぐため、短い日数での処方や、家族が薬を預かる方法を先生と相談する");
  }
  if (drugs.length > 0) {
    prescription.push(`目的と副作用:会話に出た薬(${drugs.map((d) => d.drug.label).join("、")})の目的と、ふらつき・眠気・むくみ等の副作用を確認する`);
  } else if (hasTreatmentTalk) {
    prescription.push("目的と副作用:出された薬それぞれの目的と、ふらつき・眠気等の副作用を確認する");
  }
  if (prescription.length > 0) sections.push({ heading: "2. 処方の確認", items: prescription });

  // 3. 考えられる病気(候補)
  if (candidates.length > 0) {
    sections.push({
      heading: "3. 考えられる病気(候補・診断ではありません)",
      items: candidates.map(({ candidate, matchedSymptoms, explicitEvidence }) => {
        const reasons = [
          ...matchedSymptoms.map((p) => SHORT_NAME[p.id] ?? p.label),
          ...(explicitEvidence.length > 0 ? ["病名そのものの発言"] : []),
        ];
        return `${candidate.name}:${reasons.join("・")}`;
      }),
    });
  }

  // 4. 家族の対応
  const family: string[] = [];
  if (foundIds.has("memory") || foundIds.has("identity")) {
    family.push("診察の代弁:本人が思い出しにくい・言葉にしにくいところは、家族が経過や事実を補足する");
  }
  if (candidates.some((c) => TRAUMA_CANDIDATE_IDS.has(c.candidate.id)) || safety.length > 0) {
    family.push("治療の進め方:気持ちが不安定な時期は、まず生活の安定を優先するのが一般的。つらい記憶を扱うカウンセリングの時期や進め方は先生と相談する");
  }
  family.push("緊急連絡先:具合が急に悪くなったときの、夜間・休日の連絡先を主治医に確認しておく");
  sections.push({ heading: "4. 家族の対応", items: family });

  return sections;
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

  const summary = buildSummary(utterances, symptoms, important, candidates, drugs);
  const hasTreatmentTalk = (summary.find((s) => s.id === "treatment")?.evidence.length ?? 0) > 0;
  const keyPoints = buildKeyPoints(utterances, foundIds, candidates, drugs, hasTreatmentTalk);
  const groups: SymptomGroups = {
    safety: shortNames(["suicidal", "overdose"], foundIds),
    body: shortNames(BODY_SYMPTOM_IDS, foundIds),
    mind: shortNames(MIND_SYMPTOM_IDS, foundIds),
    hardships: HARDSHIP_TOPICS.filter((t) => utterances.some((u) => includesAny(u.text, t.keywords))).map((t) => t.label),
  };

  return { groups, keyPoints, summary, important, symptoms, candidates, drugs, questions };
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

  // 一番上: 要点(短い言葉だけに凝縮したもの)
  for (const section of insights.keyPoints) {
    lines.push(`## ${section.heading}`);
    section.items.forEach((item) => lines.push(`- ${item}`));
    lines.push("");
  }

  if (insights.important.length > 0) {
    lines.push("## 先生と必ず共有しておきたいこと");
    insights.important.forEach((f) => lines.push(`- ${f.pattern.label}:${quotes(f.evidence)}`));
    lines.push("");
  }

  // 見落とせない発言(上)のすぐ下に、先生のフィードバック: まず5項目(概要・病気・治療方針・経過観察・今後の方針)で要約して見せる
  for (const item of insights.summary) {
    lines.push(`## ${item.label}`);
    item.lead.forEach((l) => lines.push(`- ${l}`));
    item.evidence.slice(0, MAX_SUMMARY_EVIDENCE).forEach((u) => lines.push(`- ${quote(u)}`));
    const rest = item.evidence.length - MAX_SUMMARY_EVIDENCE;
    if (rest > 0) lines.push(`- ほか${rest}件(下の「会話の記録(全体)」にあります)`);
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
