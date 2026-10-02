/**
 * Courbe de trafic en SVG natif (WP8d) — aucune bibliothèque de graphiques.
 * Composant serveur : le tracé est calculé et rendu côté serveur.
 */

export type TrafficChartPoint = {
  /** Libellé court du jour (ex. « 12/09 »). */
  label: string;
  visitors: number;
};

const WIDTH = 720;
const HEIGHT = 200;
const PADDING_X = 8;
const PADDING_Y = 12;

export function AnalyticsChart({ points }: { points: TrafficChartPoint[] }) {
  if (points.length === 0) {
    return <p className="text-sm text-gray-600">Aucune donnée de trafic pour le moment.</p>;
  }

  const max = Math.max(1, ...points.map((point) => point.visitors));
  const step = points.length > 1 ? (WIDTH - PADDING_X * 2) / (points.length - 1) : 0;
  const y = (value: number) =>
    HEIGHT - PADDING_Y - (value / max) * (HEIGHT - PADDING_Y * 2);

  const coordinates = points.map((point, index) => ({
    x: PADDING_X + index * step,
    y: y(point.visitors),
    ...point,
  }));

  const line = coordinates.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const area = `${PADDING_X},${HEIGHT - PADDING_Y} ${line} ${(PADDING_X + (points.length - 1) * step).toFixed(1)},${HEIGHT - PADDING_Y}`;

  return (
    <figure>
      <svg
        role="img"
        aria-label={`Visiteurs uniques par jour sur ${points.length} jours (maximum ${max})`}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-48 w-full"
      >
        {/* Lignes de repère */}
        {[0, 0.5, 1].map((ratio) => (
          <line
            key={ratio}
            x1={PADDING_X}
            x2={WIDTH - PADDING_X}
            y1={y(max * ratio)}
            y2={y(max * ratio)}
            stroke="#e5e7eb"
            strokeWidth="1"
          />
        ))}

        <polygon points={area} fill="rgba(29, 78, 216, 0.12)" />
        <polyline
          points={line}
          fill="none"
          stroke="#1d4ed8"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {coordinates.map((point) => (
          <circle key={point.label} cx={point.x} cy={point.y} r="2" fill="#1d4ed8" />
        ))}
      </svg>

      <figcaption className="mt-2 flex items-center justify-between text-xs text-gray-500">
        <span>{points[0].label}</span>
        <span>maximum : {max} visiteur{max > 1 ? "s" : ""}/jour</span>
        <span>{points[points.length - 1].label}</span>
      </figcaption>
    </figure>
  );
}
