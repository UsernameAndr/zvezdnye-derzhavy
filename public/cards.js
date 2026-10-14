/* Общие данные карт: используются и сервером, и браузером.
 * Механика соответствует базовому набору классической колодостроительной игры
 * (80 карт торгового ряда, 4 фракции). Названия и иллюстрации — оригинальные.
 */
(function (root) {
  'use strict';

  const FACTIONS = {
    blob:    { name: 'Рой',            color: '#4cb64f', dark: '#123d17', light: '#a8f0a0' },
    trade:   { name: 'Торговая Лига',  color: '#3194e6', dark: '#0d2d52', light: '#a9d6ff' },
    empire:  { name: 'Корона',         color: '#e4b42e', dark: '#4d3906', light: '#ffe7a0' },
    machine: { name: 'Машинный Орден', color: '#e04545', dark: '#4f1010', light: '#ffb0a8' },
    none:    { name: 'Нейтральная',    color: '#9aa6b8', dark: '#262d39', light: '#dfe6f0' },
    diamond: { name: 'Бриллиантовая',  color: '#7fe9ff', dark: '#0b3442', light: '#eafdff' },
  };

  const CARDS = {};
  function add(o) {
    CARDS[o.id] = Object.assign(
      { type: 'ship', outpost: false, defense: 0, count: 1, primary: [], ally: [], scrap: [] },
      o
    );
  }
  // Корабль
  const S = (id, faction, name, cost, count, primary, ally = [], scrap = [], extra = {}) =>
    add(Object.assign({ id, faction, name, cost, count, primary, ally, scrap }, extra));
  // База / аванпост
  const B = (id, faction, name, cost, count, defense, outpost, primary, ally = [], scrap = [], extra = {}) =>
    add(Object.assign({ id, faction, name, cost, count, type: 'base', defense, outpost, primary, ally, scrap }, extra));

  /* Эффекты:
   * {trade:n} {combat:n} {auth:n} {draw:n}
   * {opDiscard:n}   соперник сбрасывает n карт в начале своего хода
   * {scrapRow:n}    можно утилизировать до n карт из торгового ряда
   * {scrapHD:n}     можно утилизировать до n карт из руки или сброса
   * {destroyBase:1} можно уничтожить базу соперника (любую, включая аванпост)
   * {choose:[[...],[...]]} выбрать одно
   * {topNext:1}     следующий купленный в этот ход корабль кладётся на верх колоды
   * {freeShip:1}    взять любой корабль из ряда бесплатно на верх колоды
   * {yacht:1}       если у вас 2+ базы — возьмите 2 карты
   * {blobDraw:1}    возьмите карту за каждую карту Роя, сыгранную в этот ход
   * {recycle:n}     сбросьте до n карт, затем возьмите столько же
   * {machineBase:1} возьмите карту, затем утилизируйте карту из руки
   * {brain:n}       утилизируйте до n карт из руки/сброса, возьмите столько же
   * {copy:1}        скопировать другой корабль, сыгранный в этот ход
   * {combatPerOpBase:n} +n урона за каждую базу соперников
   * {nextToHand:1}  следующая купленная в этот ход карта идёт в руку
   * {allOpDiscard:1} каждый соперник сбрасывает карту в начале своего хода
   * {scrapForCombat:n} можно утилизировать карту из руки/сброса; если утилизировали — +n урона
   * {destroyBaseMax:n} можно уничтожить базу соперника ценой до n
   * Пассивные свойства карты: fleetHQ (все корабли +1 урон), allAlly (союзник для всех фракций),
   * faction2 (карта считается ещё и второй фракцией)
   */

  // ── Стартовые и нейтральные ──
  S('scout',    'none', 'Курьер',      0, 0, [{ trade: 1 }], [], [], { starter: true });
  S('viper',    'none', 'Перехватчик', 0, 0, [{ combat: 1 }], [], [], { starter: true });
  S('explorer', 'none', 'Старатель',   2, 0, [{ trade: 2 }], [], [{ combat: 2 }]);

  // ── Рой (зелёные): урон и чистка торгового ряда ──
  S('b_fighter',   'blob', 'Жалохват',        1, 3, [{ combat: 3 }], [{ draw: 1 }]);
  S('b_tradepod',  'blob', 'Спороносец',      2, 3, [{ trade: 3 }], [{ combat: 2 }]);
  S('b_battlepod', 'blob', 'Боевой кокон',    2, 2, [{ combat: 4 }, { scrapRow: 1 }], [{ combat: 2 }]);
  S('b_ram',       'blob', 'Таран Роя',       3, 2, [{ combat: 5 }], [{ combat: 2 }], [{ trade: 3 }]);
  S('b_destroyer', 'blob', 'Пожиратель',      4, 2, [{ combat: 6 }], [{ destroyBase: 1 }, { scrapRow: 1 }]);
  S('b_battleblob','blob', 'Живой линкор',    6, 1, [{ combat: 8 }], [{ draw: 1 }], [{ combat: 4 }]);
  S('b_carrier',   'blob', 'Матка-носитель',  6, 1, [{ combat: 7 }], [{ freeShip: 1 }]);
  S('b_mother',    'blob', 'Праматерь',       7, 1, [{ combat: 6 }, { draw: 1 }], [{ draw: 1 }]);
  B('b_wheel',     'blob', 'Кольцо Роя',      3, 3, 5, false, [{ combat: 1 }], [], [{ trade: 3 }]);
  B('b_hive',      'blob', 'Улей',            5, 1, 5, false, [{ combat: 3 }], [{ draw: 1 }]);
  B('b_world',     'blob', 'Планета-Рой',     8, 1, 7, false, [{ choose: [[{ combat: 5 }], [{ blobDraw: 1 }]] }]);

  // ── Торговая Лига (синие): деньги и здоровье ──
  S('t_shuttle',   'trade', 'Почтовый катер',      1, 3, [{ trade: 2 }], [{ auth: 4 }]);
  S('t_cutter',    'trade', 'Конвойный катер',     2, 3, [{ auth: 4 }, { trade: 2 }], [{ combat: 4 }]);
  S('t_yacht',     'trade', 'Дипломатический лайнер', 3, 2, [{ auth: 3 }, { trade: 2 }, { yacht: 1 }]);
  S('t_freighter', 'trade', 'Тяжёлый транспорт',   4, 2, [{ trade: 4 }], [{ topNext: 1 }]);
  S('t_escort',    'trade', 'Эскорт каравана',     5, 1, [{ auth: 4 }, { combat: 4 }], [{ draw: 1 }]);
  S('t_flagship',  'trade', 'Флагман Лиги',        6, 1, [{ combat: 5 }, { draw: 1 }], [{ auth: 5 }]);
  S('t_command',   'trade', 'Штабной крейсер',     8, 1, [{ auth: 4 }, { combat: 5 }, { draw: 2 }], [{ destroyBase: 1 }]);
  B('t_post',      'trade', 'Торговая станция',    3, 2, 4, true,  [{ choose: [[{ auth: 1 }], [{ trade: 1 }]] }], [], [{ combat: 3 }]);
  B('t_barter',    'trade', 'Рыночный мир',        4, 2, 4, false, [{ choose: [[{ auth: 2 }], [{ trade: 2 }]] }], [], [{ combat: 5 }]);
  B('t_defense',   'trade', 'Бастион',             5, 1, 5, true,  [{ choose: [[{ auth: 3 }], [{ combat: 2 }]] }], [{ combat: 2 }]);
  B('t_port',      'trade', 'Звёздная гавань',     6, 1, 6, true,  [{ trade: 3 }], [], [{ draw: 1 }, { destroyBase: 1 }]);
  B('t_office',    'trade', 'Биржа',               7, 1, 6, false, [{ trade: 2 }, { topNext: 1 }], [{ draw: 1 }]);

  // ── Корона (жёлтые): добор и сброс у соперника ──
  S('e_fighter',  'empire', 'Гвардейский истребитель', 1, 3, [{ combat: 2 }, { opDiscard: 1 }], [{ combat: 2 }]);
  S('e_corvette', 'empire', 'Сторожевик',      2, 2, [{ combat: 1 }, { draw: 1 }], [{ combat: 2 }]);
  S('e_frigate',  'empire', 'Фрегат Короны',   3, 3, [{ combat: 4 }, { opDiscard: 1 }], [{ combat: 2 }], [{ draw: 1 }]);
  S('e_survey',   'empire', 'Картограф',       3, 3, [{ trade: 1 }, { draw: 1 }], [], [{ opDiscard: 1 }]);
  S('e_cruiser',  'empire', 'Ударный крейсер', 6, 1, [{ combat: 5 }, { draw: 1 }], [{ opDiscard: 1 }], [{ draw: 1 }, { destroyBase: 1 }]);
  S('e_dread',    'empire', 'Колосс',          7, 1, [{ combat: 7 }, { draw: 1 }], [], [{ combat: 5 }]);
  B('e_station',  'empire', 'Орбитальный форт',      4, 2, 4, true, [{ combat: 2 }], [{ combat: 2 }], [{ trade: 4 }]);
  B('e_recycle',  'empire', 'Перерабатывающий док',  4, 2, 4, true, [{ choose: [[{ trade: 1 }], [{ recycle: 2 }]] }]);
  B('e_warworld', 'empire', 'Крепость-мир',          5, 1, 4, true, [{ combat: 3 }], [{ combat: 4 }]);
  B('e_redoubt',  'empire', 'Цитадель Короны',       6, 1, 6, true, [{ combat: 3 }], [{ opDiscard: 1 }]);
  B('e_hq',       'empire', 'Адмиралтейство',        8, 1, 8, false, [], [], [], { fleetHQ: true });

  // ── Машинный Орден (красные): утилизация слабых карт ──
  S('m_tradebot',   'machine', 'Сборщик',             1, 3, [{ trade: 1 }, { scrapHD: 1 }], [{ combat: 2 }]);
  S('m_missilebot', 'machine', 'Ракетный дрон',       2, 3, [{ combat: 2 }, { scrapHD: 1 }], [{ combat: 2 }]);
  S('m_supplybot',  'machine', 'Дрон снабжения',      3, 3, [{ trade: 2 }, { scrapHD: 1 }], [{ combat: 2 }]);
  S('m_patrol',     'machine', 'Патрульный механоид', 4, 2, [{ choose: [[{ trade: 3 }], [{ combat: 5 }]] }], [{ scrapHD: 1 }]);
  S('m_needle',     'machine', 'Мимикр',              4, 1, [{ copy: 1 }]);
  S('m_battlemech', 'machine', 'Боевой механоид',     5, 1, [{ combat: 4 }, { scrapHD: 1 }], [{ draw: 1 }]);
  S('m_missilemech','machine', 'Ракетная платформа',  6, 1, [{ combat: 6 }, { destroyBase: 1 }], [{ draw: 1 }]);
  B('m_station',    'machine', 'Оборонная батарея',   3, 2, 5, true, [], [], [{ combat: 5 }]);
  B('m_mechworld',  'machine', 'Сердце Ордена',       5, 1, 6, true, [], [], [], { allAlly: true });
  B('m_junkyard',   'machine', 'Утилизатор',          6, 1, 5, true, [{ scrapHD: 1 }]);
  B('m_forge',      'machine', 'Кузница',             7, 1, 6, true, [{ machineBase: 1 }]);
  B('m_brain',      'machine', 'Ядро Разума',         8, 1, 6, true, [{ brain: 2 }]);

  /* ── Новые карты (дополнение «Новые карты», включает хост) ── */
  const NS = (...a) => { S(...a); CARDS[a[0]].exp = 'new'; };
  const NB = (...a) => { B(...a); CARDS[a[0]].exp = 'new'; };
  NS('b_spores',      'blob',    'Споровое облако',     3, 2, [{ combat: 4 }], [{ scrapRow: 1 }, { combat: 2 }]);
  NB('b_parasite',    'blob',    'Гнездо-паразит',      4, 1, 4, false, [{ combat: 2 }], [{ combat: 2 }]);
  NS('b_worldeater',  'blob',    'Пожиратель миров',    7, 1, [{ combat: 8 }, { combatPerOpBase: 2 }]);
  NS('t_insurer',     'trade',   'Страховой агент',     2, 2, [{ trade: 2 }, { auth: 2 }]);
  NB('t_bank',        'trade',   'Банк Лиги',           6, 1, 6, false, [{ choose: [[{ trade: 3 }], [{ auth: 5 }]] }], [{ draw: 1 }]);
  NS('t_recruiter',   'trade',   'Вербовщик',           4, 1, [{ trade: 2 }, { nextToHand: 1 }]);
  NS('e_censor',      'empire',  'Цензор',              5, 1, [{ combat: 5 }, { opDiscard: 1 }], [], [{ draw: 2 }]);
  NB('e_academy',     'empire',  'Имперская академия',  5, 1, 5, true, [{ trade: 1 }], [{ draw: 1 }]);
  NS('e_doubleagent', 'empire',  'Двойной агент',       3, 2, [{ combat: 3 }], [], [], { faction2: 'trade' });
  NS('m_assembler',   'machine', 'Сборочный дрон',      3, 2, [{ combat: 2 }, { scrapHD: 1 }]);
  NB('m_smelter',     'machine', 'Переплавка',          4, 1, 5, true, [{ scrapForCombat: 3 }]);
  NS('n_boarder',     'none',    'Абордажный крейсер',  5, 1, [{ combat: 4 }, { destroyBaseMax: 4 }]);

  /* ── Бриллиантовые карты (дополнение) ──
   * Очень дорогие (12–18). В торговую колоду не входят: изредка сами появляются в ряду
   * вместо обычной карты, в ряду — не больше одной; если её не купили за 3 круга, она исчезает.
   * Считаются союзником для карт любой фракции.
   */
  const DS = (id, name, cost, primary) => add({ id, faction: 'diamond', name, cost, count: 1, rarity: 'diamond', primary, allAlly: true });
  const DB = (id, name, cost, defense, outpost, primary) => add({ id, faction: 'diamond', name, cost, count: 1, rarity: 'diamond', type: 'base', defense, outpost, primary, allAlly: true });
  DS('d_ark',         'Ковчег изобилия',      12, [{ trade: 8 }, { draw: 2 }]);
  DB('d_eye',         'Око Галактики',        13, 10, false, [{ trade: 4 }, { draw: 1 }]);
  DS('d_supernova',   'Сверхновая',           14, [{ combat: 14 }, { destroyBase: 1 }]);
  DS('d_crown',       'Венец Вечности',       15, [{ auth: 10 }, { combat: 8 }, { allOpDiscard: 1 }]);
  DB('d_citadel',     'Алмазная цитадель',    16, 15, true, [{ combat: 5 }, { auth: 3 }]);
  DS('d_singularity', 'Сингулярность',        18, [{ combat: 10 }, { draw: 2 }, { brain: 3 }]);

  /* ── Герои (дополнение, включает хост) ──
   * Покупаются из торгового ряда, но не идут в колоду: герой сразу встаёт рядом с вами и остаётся,
   * пока вы его не отпустите. Пока герой рядом, он — союзник своей фракции для всех ваших карт
   * (в режиме 2 на 2 — и для карт напарника). В свой ход героя можно утилизировать ради разового эффекта.
   */
  const Hr = (id, faction, name, cost, scrap) => add({ id, faction, name, cost, count: 1, type: 'hero', scrap });
  Hr('h_packleader',  'blob',    'Вожак стаи',          2, [{ combat: 4 }]);
  Hr('h_broodqueen',  'blob',    'Королева выводка',    6, [{ combat: 5 }, { draw: 1 }]);
  Hr('h_envoy',       'trade',   'Посол Лиги',          2, [{ auth: 5 }]);
  Hr('h_magnate',     'trade',   'Магнат',              5, [{ trade: 4 }, { auth: 3 }]);
  Hr('h_guardcapt',   'empire',  'Капитан гвардии',     3, [{ combat: 2 }, { draw: 1 }]);
  Hr('h_grandadm',    'empire',  'Гранд-адмирал',       6, [{ draw: 2 }, { opDiscard: 1 }]);
  Hr('h_technopriest','machine', 'Техножрец',           2, [{ scrapHD: 1 }]);
  Hr('h_architect',   'machine', 'Архитектор Ордена',   5, [{ combat: 4 }, { scrapHD: 1 }]);
  Hr('h_mercenary',   'none',    'Наёмник',             3, [{ combat: 5 }]);
  Hr('h_smuggler',    'none',    'Контрабандист',       3, [{ choose: [[{ trade: 4 }], [{ combat: 4 }]] }]);

  const api = { FACTIONS, CARDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
