/**
 * /api/classify は呼ばれるたびに外部AI(Claude等)を叩いて課金が発生するため、
 * 誤って無限ループしたクライアントや連打・簡単なスクリプト攻撃から料金の暴走を
 * 防ぐための簡易レート制限。
 *
 * Vercelのサーバーレス関数はウォームインスタンス間でしかメモリを共有しないため、
 * これは「同じインスタンスに当たっている間」のベストエフォートな制限であり、
 * 分散した大規模攻撃を完全に防ぐものではない。ただし外部DB/KVを新たに増やさずに
 * 導入できる、費用面の最低限の安全網として設置する。
 */

interface Bucket {
  count: number;
  windowStart: number;
}

const WINDOW_MS = 60_000;
// 実際の会議利用(発言ごとに1回、数秒〜十数秒に1回程度)なら十分すぎる余裕がある値
const PER_IP_LIMIT = 30;
// このインスタンス全体での1分あたりの上限(費用の最終防波堤)
const GLOBAL_LIMIT = 300;

const buckets = new Map<string, Bucket>();

function checkBucket(key: string, limit: number, now: number): boolean {
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

/** 古いバケットが溜まり続けないよう、呼び出しのついでに掃除する */
function cleanup(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= WINDOW_MS) buckets.delete(key);
  }
}

export function isRateLimited(ip: string): boolean {
  const now = Date.now();
  cleanup(now);
  // 両方チェックする(片方だけ先に評価してショートサーキットすると、もう一方の
  // カウントが増えずに制限がすり抜けられるため)
  const globalOk = checkBucket("__global__", GLOBAL_LIMIT, now);
  const ipOk = checkBucket(`ip:${ip}`, PER_IP_LIMIT, now);
  return !globalOk || !ipOk;
}
