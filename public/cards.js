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
   * Пассивные свойства карты: fleetHQ (все корабли +1 урон), allAlly (союзник для всех фракций)
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

  const api = { FACTIONS, CARDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
