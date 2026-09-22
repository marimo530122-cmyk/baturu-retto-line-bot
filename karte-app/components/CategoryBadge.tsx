import { CATEGORY_COLOR, CATEGORY_LABEL, Category } from "@/lib/types";

export function CategoryBadge({ category }: { category: Category }) {
  const color = CATEGORY_COLOR[category];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${color.bg} ${color.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${color.dot}`} />
      {CATEGORY_LABEL[category]}
    </span>
  );
}
