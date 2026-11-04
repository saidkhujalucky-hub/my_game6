export const MAX_PLAYERS = 12;
export const BASE_RADIUS = 150;
export const MAP_RADIUS = 195;
export const RESPAWN_MS = 5500;
export const UPGRADE_COSTS = [120, 260, 480];

export const HEROES = [
  {id:'volt',name:'ВОЛЬТ',type:'Энергия',color:0x18d8ff,accent:0xffff70,weapon:'Плазменный бластер',ability:'Электрошторм',skill:'nova',speed:13.6,hp:125,damage:16,rate:350,projectileSpeed:51,skillCooldown:13000,skillCost:45},
  {id:'titan',name:'ТИТАН',type:'Сила',color:0xff8a54,accent:0xffd087,weapon:'Тяжёлые импульсы',ability:'Неуязвимость',skill:'shield',speed:10.8,hp:190,damage:24,rate:690,projectileSpeed:39,skillCooldown:16000,skillCost:40},
  {id:'spectra',name:'СПЕКТРА',type:'Свет',color:0xcba2ff,accent:0xffb6e7,weapon:'Фотонная винтовка',ability:'Скачок света',skill:'blink',speed:14.3,hp:115,damage:14,rate:270,projectileSpeed:61,skillCooldown:10000,skillCost:32},
  {id:'frost',name:'КРИО',type:'Лёд',color:0x71caff,accent:0xe6fcff,weapon:'Ледяные шары',ability:'Ледяная волна',skill:'nova',speed:12.1,hp:140,damage:18,rate:500,projectileSpeed:42,skillCooldown:14500,skillCost:50},
  {id:'ember',name:'ЭМБЕР',type:'Огонь',color:0xff6942,accent:0xffdd5f,weapon:'Пламенные сферы',ability:'Огненный залп',skill:'barrage',speed:12.9,hp:135,damage:19,rate:470,projectileSpeed:47,skillCooldown:12000,skillCost:45},
  {id:'phantom',name:'ФАНТОМ',type:'Тень',color:0x8d8cfc,accent:0x4cf4df,weapon:'Теневые дротики',ability:'Теневой рывок',skill:'dash',speed:15.3,hp:105,damage:13,rate:240,projectileSpeed:60,skillCooldown:8000,skillCost:25},
  {id:'nature',name:'ФЛОРА',type:'Природа',color:0x59eb91,accent:0xc9ffad,weapon:'Листовые диски',ability:'Регенерация',skill:'heal',speed:12.4,hp:150,damage:17,rate:430,projectileSpeed:47,skillCooldown:16000,skillCost:42},
  {id:'storm',name:'ШТОРМ',type:'Погода',color:0x54afff,accent:0xf8f6b5,weapon:'Грозовые разряды',ability:'Перегрузка',skill:'speed',speed:13.8,hp:120,damage:15,rate:290,projectileSpeed:58,skillCooldown:14000,skillCost:36},
  {id:'nova',name:'НОВА',type:'Космос',color:0xffdf62,accent:0xff81ae,weapon:'Звёздные болты',ability:'Сверхновая',skill:'nova',speed:12.8,hp:135,damage:21,rate:520,projectileSpeed:48,skillCooldown:16000,skillCost:55},
  {id:'guardian',name:'СТРАЖ',type:'Техника',color:0x60d1c7,accent:0xfafcff,weapon:'Магнитная пушка',ability:'Энергокупол',skill:'shield',speed:11.6,hp:170,damage:21,rate:590,projectileSpeed:44,skillCooldown:15500,skillCost:42},
  {id:'comet',name:'КОМЕТА',type:'Скорость',color:0xf35adb,accent:0x93d6ff,weapon:'Квантовые иглы',ability:'Ускорение',skill:'speed',speed:16,hp:110,damage:12,rate:215,projectileSpeed:63,skillCooldown:12000,skillCost:35},
  {id:'pulse',name:'ПУЛЬСАР',type:'Гравитация',color:0x9880ff,accent:0xf9e9ff,weapon:'Грави-заряды',ability:'Пульс пустоты',skill:'nova',speed:12.2,hp:145,damage:22,rate:560,projectileSpeed:40,skillCooldown:15000,skillCost:48}
];

export function basePosition(slot) {
  const angle = (slot / MAX_PLAYERS) * Math.PI * 2 - Math.PI / 2;
  return { x: Math.cos(angle) * BASE_RADIUS, z: Math.sin(angle) * BASE_RADIUS };
}

export function clampToArena(x, z, radius = MAP_RADIUS - 4) {
  const length = Math.hypot(x, z);
  if (length > radius) return { x: x * radius / length, z: z * radius / length };
  return { x, z };
}

export function publicPlayer(p, now = Date.now()) {
  return {
    id:p.id,name:p.name,hero:p.hero,slot:p.slot,x:p.x,z:p.z,rot:p.rot,
    hp:p.hp,maxHp:p.maxHp,energy:Math.round(p.energy),coins:p.coins,
    baseLevel:p.baseLevel,kills:p.kills,downs:p.downs,
    shield:p.shieldUntil > now,boost:p.boostUntil > now,
    respawn:Math.max(0,p.respawnAt-now),
    skillReady:Math.max(0,p.lastSkill + HEROES[p.hero].skillCooldown - now)
  };
}
