export const COMPETITION_COLOR_PALETTE = [
  '#E63946',
  '#F77F00',
  '#F4B942',
  '#7CB518',
  '#2A9D8F',
  '#00A6A6',
  '#0096C7',
  '#4361EE',
  '#3A0CA3',
  '#7209B7',
  '#B5179E',
  '#D81159',
  '#EF476F',
  '#FF7F51',
  '#C76D00',
  '#6A994E',
  '#00856A',
  '#118AB2',
  '#355070',
  '#5A4FCF',
  '#8F2D9C',
  '#C44536',
  '#A44A3F',
  '#587B7F',
  '#6D597A',
];

export function createCompetitionColorRegistry(
  currentUserId,
  currentUserColor,
  random = Math.random,
) {
  const ownerColors = new Map([[currentUserId, currentUserColor]]);
  const usedColors = new Set([currentUserColor.toUpperCase()]);
  return {
    colorFor(ownerUserId) {
      let displayColor = ownerColors.get(ownerUserId);
      if (!displayColor) {
        const firstColorIndex = Math.floor(random() * COMPETITION_COLOR_PALETTE.length);
        for (let offset = 0; offset < COMPETITION_COLOR_PALETTE.length; offset += 1) {
          const index = (firstColorIndex + offset) % COMPETITION_COLOR_PALETTE.length;
          const candidate = COMPETITION_COLOR_PALETTE[index];
          if (candidate && !usedColors.has(candidate)) {
            displayColor = candidate;
            break;
          }
        }
        displayColor ??= COMPETITION_COLOR_PALETTE[firstColorIndex] ?? COMPETITION_COLOR_PALETTE[0];
        ownerColors.set(ownerUserId, displayColor);
        usedColors.add(displayColor);
      }
      return displayColor;
    },
  };
}
