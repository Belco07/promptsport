/** Editorial heuristic, not a measure of real social engagement. */
export function computeViralScore(input: { title: string; publishedAt: Date; isOfficial: boolean; reliability?: number }, now = new Date()): number {
  const text = input.title.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const keywords = ["breaking", "urgent", "officiel", "official", "transfert", "signature", "blessure", "forfait", "record", "clash", "polemique", "demission", "licencie", "limoge", "accord", "visite medicale", "here we go", "exclusivite"];
  const matches = keywords.filter(word => text.includes(word)).length;
  const age = now.getTime() - input.publishedAt.getTime();
  return Math.min(5, 1 + (input.isOfficial ? 2 : 0) + ((input.reliability ?? 0) >= 80 ? 1 : 0) + Math.min(matches, 2) + (age >= -21600000 && age <= 7200000 ? 1 : 0));
}
