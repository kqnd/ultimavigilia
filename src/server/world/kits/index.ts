import type { ClassId } from '../../../shared/config/classes.js';
import { berserkerKit } from './berserker.js';
import { dogKit } from './dog.js';
import { hunterKit } from './hunter.js';
import { lapanhaKit } from './lapanha.js';
import type { Kit } from './kit.js';
import { mageKit } from './mage.js';
import { necromancerKit } from './necromancer.js';
import { tankKit } from './tank.js';
import { vampireKit } from './vampire.js';

const KITS: Record<ClassId, Kit> = {
  hunter: hunterKit,
  mage: mageKit,
  tank: tankKit,
  vampire: vampireKit,
  berserker: berserkerKit,
  dog: dogKit,
  necromancer: necromancerKit,
  lapanha: lapanhaKit,
};

export const kitFor = (c: ClassId): Kit => KITS[c];
