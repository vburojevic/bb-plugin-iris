// Icon name normalizing, shared by the main bundle and the iris-react frame.

/** "triangle-alert", "triangleAlert" and "TriangleAlert" all name one icon. Old Lucide names map too. */
export function iconKey(name: string): string {
  const pascal = name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
  return ALIASES[pascal] ?? pascal;
}

export const ALIASES: Record<string, string> = {
  AlertTriangle: "TriangleAlert", AlertCircle: "CircleAlert", CheckCircle: "CircleCheck", CheckCircle2: "CircleCheckBig", XCircle: "CircleX",
  MinusCircle: "CircleMinus", PlusCircle: "CirclePlus", HelpCircle: "CircleHelp", Edit: "Pencil", Trash: "Trash2", Settings2: "Settings2",
  BarChart: "ChartBar", BarChart2: "ChartColumn", LineChart: "ChartLine", PieChart: "ChartPie", Github: "Github", Home: "House",
};

