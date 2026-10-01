/** Efeitos: projéteis, partículas, sombras, impactos, luzes e marcadores. */
import { bayer, type Color, PixelCanvas, SheetBuilder } from './pixel.js';
import { P } from './palette.js';

function shadow(w: number, h: number): PixelCanvas {
  const c = new PixelCanvas(w, h);
  c.ellipse(w / 2, h / 2, w / 2, h / 2, P.ink, 120);
  c.ellipse(w / 2, h / 2, w / 2 - 2, h / 2 - 1, P.ink, 60);
  return c;
}

function orbSprite(size: number, ramp: [Color, Color, Color, Color], frame: number): PixelCanvas {
  const c = new PixelCanvas(size, size);
  const r = size / 2 - 1;
  c.ellipse(size / 2, size / 2, r, r, ramp[0]);
  c.ellipse(size / 2, size / 2, r - 1, r - 1, ramp[1]);
  c.ellipse(size / 2 - 0.5, size / 2 - 0.5, r - 2.2, r - 2.2, ramp[2]);
  c.set(Math.floor(size / 2) - 1 + frame, Math.floor(size / 2) - 1, ramp[3]);
  c.set(Math.floor(size / 2) - 1, Math.floor(size / 2) - 2 + frame, ramp[3]);
  return c;
}

/** Círculo com anéis de alfa escalonados (luz pixelada para a máscara de escuridão). */
export function lightDisc(r: number): PixelCanvas {
  const c = new PixelCanvas(r * 2, r * 2);
  for (let y = 0; y < r * 2; y++)
    for (let x = 0; x < r * 2; x++) {
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r;
      if (d > 1) continue;
      // faixas + dithering nas bordas das faixas
      const v = 1 - d;
      const band = Math.min(1, Math.floor((v + bayer(x >> 1, y >> 1) * 0.12) * 5) / 4);
      c.set(x, y, 0xffffff, Math.round(band * 255));
    }
  return c;
}

export function buildFxSheet(): SheetBuilder {
  const sb = new SheetBuilder();
  // projéteis (apontando para a direita)
  const bolt = new PixelCanvas(11, 3);
  bolt.hline(0, 8, 1, P.brn4);
  bolt.hline(8, 10, 1, P.sil2);
  bolt.set(9, 0, P.sil1);
  bolt.set(9, 2, P.sil1);
  bolt.set(0, 0, P.gray5);
  bolt.set(0, 2, P.gray5);
  sb.add('proj_bolt', bolt);
  const pb = new PixelCanvas(16, 5);
  pb.hline(0, 11, 2, P.sil1);
  pb.hline(11, 15, 2, P.white);
  pb.hline(12, 14, 1, P.sil2);
  pb.hline(12, 14, 3, P.sil2);
  pb.set(0, 1, P.sil0);
  pb.set(0, 3, P.sil0);
  sb.add('proj_pierceBolt', pb);
  for (let f = 0; f < 2; f++) {
    sb.add(`proj_missile_${f}`, orbSprite(9, [P.arc0, P.arc1, P.arc2, P.white], f));
    sb.add(`proj_empMissile_${f}`, orbSprite(14, [P.arc1, P.arc2, P.arc3, P.white], f));
    sb.add(`proj_orb_${f}`, orbSprite(11, [P.abyss1, P.abyss2, P.abyss3, P.abyss4], f));
    sb.add(`proj_abyssOrb_${f}`, orbSprite(11, [P.abyss0, P.abyss2, P.abyss4, P.white], f));
  }
  const sl = new PixelCanvas(10, 6);
  sl.rect(1, 1, 8, 4, P.amb3);
  sl.rect(3, 1, 1, 4, P.blue4);
  sl.set(4, 2, P.blue4);
  sl.set(4, 3, P.blue4);
  sl.hline(1, 8, 4, P.amb1);
  sl.outline(P.outline);
  sb.add('proj_slipper', sl);
  // sombras
  sb.add('shadow_s', shadow(14, 5));
  sb.add('shadow_m', shadow(22, 7));
  sb.add('shadow_l', shadow(36, 11));
  sb.add('shadow_xl', shadow(64, 18));
  // partículas
  const px = (name: string, w: number, h: number, col: Color): void => {
    const c = new PixelCanvas(w, h);
    c.rect(0, 0, w, h, col);
    sb.add(name, c);
  };
  px('p_white', 2, 2, P.white);
  px('p_px', 1, 1, P.white);
  px('p_ember', 2, 2, P.amb4);
  px('p_blood', 2, 2, P.red3);
  px('p_bone', 3, 2, P.gray5);
  px('p_arc', 2, 2, P.arc3);
  px('p_ice', 2, 2, P.ice3);
  px('p_mag', 2, 2, P.mag2);
  px('p_abyss', 2, 2, P.abyss4);
  px('p_dust', 2, 2, P.gray3);
  px('p_leaf', 3, 2, P.grn4);
  px('p_silver', 2, 2, P.sil2);
  px('p_snow', 2, 2, P.gray6);
  px('p_snowbig', 3, 3, P.ice3);
  px('p_ash', 2, 2, 0x8a7a6a);
  px('p_cinder', 2, 1, P.amb3);
  px('p_soul', 2, 2, 0xa8d05a);
  px('p_frost', 2, 2, P.ice2);
  px('p_heal', 2, 2, P.red5);
  px('p_wood', 3, 2, P.brn4);
  px('p_mist', 3, 2, 0x9aa6c0);
  px('p_shadow', 2, 2, 0x2a1a3a);
  px('p_rune', 2, 2, 0x7dffb0);
  // Maycon: fumaça (cinza-azulada, grande), cachaça (âmbar) e vidro
  px('p_smoke', 3, 3, 0x8a93a8);
  px('p_smokeDark', 4, 3, 0x565b70);
  px('p_booze', 2, 2, 0xf0b54a);
  px('p_glass', 2, 1, 0xb8f0a0);
  // projétil de osso (Rajada Óssea)
  const bone = new PixelCanvas(12, 7);
  bone.hline(2, 9, 3, P.gray6);
  bone.hline(2, 9, 4, P.gray5);
  for (const x of [0, 10]) {
    bone.rect(x, 1, 2, 2, P.gray6);
    bone.rect(x, 4, 2, 2, P.gray5);
  }
  bone.set(11, 3, 0xd8f08a);
  bone.outline(P.outline);
  sb.add('proj_bone', bone);
  // estilhaço de gelo (Noiva do Inverno)
  for (let f = 0; f < 2; f++) {
    const sh = new PixelCanvas(12, 8);
    sh.line(0, 4, 10, 3 + f, P.ice3);
    sh.line(1, 5, 9, 4 + f, P.ice2);
    sh.line(2, 3, 8, 3, P.ice1);
    sh.set(11, 3 + f, P.white);
    sh.outline(P.outline);
    sb.add(`proj_iceShard_${f}`, sh);
  }
  for (let f = 0; f < 4; f++) {
    const d = new PixelCanvas(10, 10);
    const r = 2 + f;
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 10; x++) {
        const dd = Math.hypot(x + 0.5 - 5, y + 0.5 - 5);
        if (dd <= r && bayer(x, y) < 0.9 - f * 0.2) d.set(x, y, f < 2 ? P.gray3 : P.gray2);
      }
    sb.add(`dust_${f}`, d);
  }
  // impacto
  for (let f = 0; f < 3; f++) {
    const c = new PixelCanvas(17, 17);
    const len = 3 + f * 3;
    const col = f === 2 ? P.gray5 : P.white;
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2 + (f % 2) * 0.39;
      const l = a % 2 ? len * 0.6 : len;
      c.line(8, 8, 8 + Math.cos(ang) * l, 8 + Math.sin(ang) * l, col);
    }
    if (f === 0) c.ellipse(8.5, 8.5, 3, 3, P.white);
    sb.add(`hit_${f}`, c);
  }
  // melancias em voo (listras giram entre os quadros): pequena, larga, densa e a Madura
  const melon = (w: number, h: number, frame: number, dense: boolean): PixelCanvas => {
    const c = new PixelCanvas(w, h);
    c.ellipse(w / 2, h / 2, w / 2 - 0.5, h / 2 - 0.5, dense ? 0x2f7a35 : 0x4fb04a);
    for (let x = frame; x < w; x += 3) for (let y = 0; y < h; y++) if (c.alpha(x, y) > 0) c.set(x, y, 0x24602a);
    c.set(Math.floor(w / 3), 1, 0xb8f0a0);
    c.outline(P.outline);
    return c;
  };
  for (let f = 0; f < 2; f++) {
    sb.add(`proj_melon_${f}`, melon(8, 7, f, false));
    sb.add(`proj_melonWide_${f}`, melon(10, 7, f, false));
    sb.add(`proj_melonDense_${f}`, melon(7, 7, f, true));
    sb.add(`proj_bigMelon_${f}`, melon(13, 11, f, false));
    // semente saltitante
    const sd = new PixelCanvas(3, 4);
    sd.rect(0, f, 3, 3, 0x2a1a14);
    sd.set(1, f, 0x6a4a3a);
    sb.add(`proj_seed_${f}`, sd);
    // pulso da Ferida Profana: runa verde-pálida com núcleo violeta
    const wb = new PixelCanvas(9, 9);
    wb.ellipse(4.5, 4.5, 4, 4, 0x2a1a3a);
    wb.ring(4.5, 4.5, 4, 1, 0x7dffb0);
    wb.ellipse(4.5, 4.5, 1.5 + f * 0.5, 1.5 + f * 0.5, P.abyss3);
    wb.outline(P.outline);
    sb.add(`proj_woundBolt_${f}`, wb);
    // Maycon: garrafa girando (deitada / inclinada) e bomba de fumaça com pavio aceso
    const bt = new PixelCanvas(9, 9);
    const glass = 0x3f9a3a;
    const dark = 0x1f5a2a;
    if (f === 0) {
      bt.rect(0, 3, 5, 3, glass);
      bt.hline(0, 4, 5, dark);
      bt.rect(5, 4, 2, 1, glass);
      bt.set(7, 4, 0xb08262);
      bt.set(1, 3, 0xd8f6c8);
    } else {
      for (let k = 0; k < 4; k++) bt.rect(1 + k, 5 - k, 2, 2, glass);
      bt.set(1, 6, dark);
      bt.set(6, 1, glass);
      bt.set(7, 0, 0xb08262);
      bt.set(2, 4, 0xd8f6c8);
    }
    bt.outline(P.outline);
    sb.add(`proj_bottle_${f}`, bt);
    const cb = new PixelCanvas(10, 11);
    cb.ellipse(5, 6.5, 3.6, 3.6, P.gray1);
    cb.ellipse(4.5, 6, 2, 2, P.gray2);
    cb.set(3, 5, P.gray4);
    cb.rect(4, 1, 2, 2, P.gray3);
    cb.set(6, 0, f ? P.amb5 : P.amb3);
    cb.set(7, f ? 0 : 1, f ? P.amb3 : P.red5);
    cb.outline(P.outline);
    sb.add(`proj_chokeBomb_${f}`, cb);
  }
  // casca de melancia no chão (Lapanha): meia-lua verde com a parte branca e um fio vermelho
  const peel = new PixelCanvas(16, 8);
  peel.ellipse(8, 2, 7.5, 5.5, 0x3f9a3a);
  peel.ellipse(8, 1, 6, 4, 0xe8e2c8);
  peel.ellipse(8, 0, 5, 3, 0xd84a4a);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 16; x++) if (y < 2) peel.clear(x, y);
  peel.hline(3, 12, 2, 0xd84a4a);
  peel.outline(P.outline);
  sb.add('peel', peel);
  const peel2 = peel.clone();
  peel2.hline(4, 11, 2, 0xff9a8a);
  sb.add('peel_ready', peel2);
  // poça (Piso Molhado)
  const wet = new PixelCanvas(20, 9);
  wet.ellipse(10, 4.5, 9.5, 4, 0xc84848, 110);
  wet.ellipse(8, 4, 5, 2, 0xff8a7a, 90);
  sb.add('wetFloor', wet);
  px('p_seed', 2, 2, 0x2a1a14);
  px('p_pulp', 2, 2, 0xe04848);
  px('p_pulpLight', 2, 2, 0xff9a8a);
  px('p_rind', 3, 2, 0x3f9a3a);
  px('p_wound', 2, 2, 0x9a4acb);
  px('p_star', 2, 2, P.amb5);
  // armadilha de prata
  const trap = new PixelCanvas(18, 10);
  trap.ellipse(9, 5, 8, 4, P.gray2);
  trap.ellipse(9, 5, 5, 2, P.gray1);
  for (let x = 2; x < 17; x += 2) {
    trap.set(x, 1, P.sil2);
    trap.set(x, 8, P.sil2);
  }
  trap.ellipse(9, 5, 1.5, 1.5, P.sil1);
  trap.outline(P.outline);
  sb.add('trap', trap);
  // marcadores
  const ping = new PixelCanvas(13, 17);
  ping.ellipse(6.5, 6, 6, 6, P.amb4);
  ping.ellipse(6.5, 6, 3, 3, P.white);
  for (let y = 10; y < 17; y++) ping.hline(6 - Math.max(0, 16 - y) / 2, 6 + Math.max(0, 16 - y) / 2, y, P.amb4);
  ping.outline(P.ink);
  sb.add('ping', ping);
  const arrow = new PixelCanvas(9, 9);
  for (let y = 0; y < 9; y++) {
    const w = 4 - Math.abs(4 - y);
    arrow.hline(0, w * 2, y, P.white);
  }
  sb.add('arrow', arrow);
  const mark = new PixelCanvas(7, 7);
  mark.line(0, 3, 3, 0, P.red4);
  mark.line(3, 0, 6, 3, P.red4);
  mark.line(6, 3, 3, 6, P.red4);
  mark.line(3, 6, 0, 3, P.red4);
  mark.set(3, 3, P.red5);
  sb.add('mark', mark);
  // cabeça do jogador (ícone de aliados)
  const dot = new PixelCanvas(5, 5);
  dot.ellipse(2.5, 2.5, 2.5, 2.5, P.white);
  sb.add('dot', dot);
  return sb;
}

export const LIGHT_RADII = [24, 48, 72, 112, 160] as const;
