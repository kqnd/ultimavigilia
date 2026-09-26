/** Caixas e barris destrutíveis e o item de cura que eles podem deixar. */

export const BREAKABLES = {
  crate: { hp: 30, name: 'Caixa' },
  barrel: { hp: 40, name: 'Barril' },
  /** Chance de deixar um item de cura ao quebrar. */
  dropChance: 0.4,
  /** No intervalo, objetos quebrados longe de jogadores/inimigos voltam (fração dos destruídos). */
  respawnFraction: 0.5,
} as const;

export const PICKUPS = {
  heal: {
    /** Cura vida atual (nunca aumenta a vida máxima). */
    amount: 22,
    radius: 14,
    lifetime: 25,
  },
  /** Máximo de itens no chão; o mais antigo some quando passa disso. */
  maxActive: 6,
} as const;

export type PickupKind = 'heal';
export const PICKUP_KINDS: readonly PickupKind[] = ['heal'];
