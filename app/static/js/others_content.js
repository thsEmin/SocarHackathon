/* Content of the "Others" page: equations, reference-plot notes, calculator labels and glossary, in EN / AZ / RU.
   Every equation is the one PetroNova itself uses (src/pta.py, src/vfm.py, app/services/insights.py,
   app/services/diagnostics.py), in field units. Loaded on every page so the top-bar search can find these cards.
   Azerbaijani and Russian texts should be proofread by the team's petroleum engineers. */
(function () {
  // ---------- tiny MathML builder (built into browsers: works offline, no library)
  const i = x => `<mi>${x}</mi>`, n = x => `<mn>${x}</mn>`, o = x => `<mo>${x}</mo>`, tx = x => `<mtext>${x}</mtext>`;
  const r = (...a) => `<mrow>${a.join("")}</mrow>`;
  const fr = (a, b) => `<mfrac>${r(a)}${r(b)}</mfrac>`;
  const sb = (a, b) => `<msub>${r(a)}${r(b)}</msub>`;
  const sp = (a, b) => `<msup>${r(a)}${r(b)}</msup>`;
  const sq = a => `<msqrt>${a}</msqrt>`;
  const p = (...a) => r(o("("), ...a, o(")"));
  const bk = (...a) => r(o("["), ...a, o("]"));
  const M = (...a) => `<math display="block">${a.join("")}</math>`;
  const log = (...a) => r(sb(i("log"), n(10)), o("&#x2061;"), p(...a));
  const ln = (...a) => r(i("ln"), o("&#x2061;"), p(...a));
  const x = o("·"), eq = o("="), mi = o("−"), pl = o("+");
  const D = i("Δ");
  const pwf = sb(i("p"), tx("wf")), p1 = sb(i("p"), tx("1hr")), ps = sp(i("P"), o("*")), tp = sb(i("t"), tx("p"));
  const ct = sb(i("c"), tx("t")), rw = sb(i("r"), tx("w")), dps = sb(r(D, i("P")), tx("skin"));
  const T = (en, az, ru) => ({ en, az, ru });

  // ---------- symbols used in several equations: [symbol, meaning, unit]
  const S = {
    q: ["q", T("oil rate before the shut-in (from VFM)", "bağlanmadan əvvəlki neft debiti (VFM)", "дебит нефти до остановки (по VFM)"), "stb/d"],
    B: ["B", T("oil formation volume factor", "neftin həcm əmsalı", "объёмный коэффициент нефти"), "rb/stb"],
    mu: ["μ", T("oil viscosity", "neftin özlülüyü", "вязкость нефти"), "cp"],
    m: ["m", T("Horner slope: pressure rise per log cycle", "Horner meyli: bir log dövrəsində təzyiq artımı", "наклон Хорнера: рост давления за логарифмический цикл"), "psi/cycle"],
    h: ["h", T("net pay thickness", "effektiv qalınlıq", "эффективная толщина пласта"), "ft"],
    k: ["k", T("permeability", "keçiricilik", "проницаемость"), "md"],
    phi: ["φ", T("porosity", "məsaməlilik", "пористость"), "fraction"],
    ct: ["ct", T("total compressibility", "ümumi sıxılma əmsalı", "общая сжимаемость"), "1/psi"],
    rw: ["rw", T("wellbore radius", "quyu radiusu", "радиус скважины"), "ft"],
    pwf: ["pwf", T("flowing bottom-hole pressure just before shut-in", "bağlanmadan dərhal əvvəl quyudibi işçi təzyiq", "забойное давление перед остановкой"), "psia"],
    p1: ["p1hr", T("pressure on the Horner line at Δt = 1 hour", "Horner xəttində Δt = 1 saatdakı təzyiq", "давление на прямой Хорнера при Δt = 1 ч"), "psia"],
    ps: ["P*", T("extrapolated pressure (Horner line at infinite shut-in)", "ekstrapolyasiya edilmiş təzyiq (sonsuz bağlanmada Horner xətti)", "экстраполированное давление (прямая Хорнера при бесконечной остановке)"), "psia"],
    tp: ["tp", T("equivalent producing time", "ekvivalent hasilat müddəti", "эквивалентное время работы"), "h"],
    dt: ["Δt", T("time since shut-in", "bağlanmadan keçən vaxt", "время после остановки"), "h"],
    S: ["S", T("skin factor (dimensionless)", "skin əmsalı (ölçüsüz)", "скин-фактор (безразмерный)"), "–"],
    dps: ["ΔP skin", T("extra pressure drop caused by skin", "skinin yaratdığı əlavə təzyiq düşküsü", "дополнительная депрессия из-за скина"), "psi"],
    dd: ["drawdown", T("reservoir pressure minus flowing bottom-hole pressure", "lay təzyiqi minus quyudibi işçi təzyiq", "пластовое давление минус забойное"), "psi"],
    FE: ["FE", T("flow efficiency", "axın səmərəliliyi", "гидродинамическое совершенство"), "fraction"],
  };

  const G = { pta: T("Pressure transient analysis (build-up)", "Təzyiq bərpası təhlili (PTA)", "Анализ КВД (ГДИС)"),
              prod: T("Production, VFM and scenarios", "Hasilat, VFM və ssenarilər", "Добыча, VFM и сценарии") };

  // ---------- equations: id, group, title, formula, symbols, explanation, where it is in the app, extra search words
  const EQ = [
    { id: "tp", g: "pta", t: T("Equivalent producing time", "Ekvivalent hasilat müddəti", "Эквивалентное время работы"),
      f: M(tp, eq, fr(r(n(24), x, sb(i("N"), tx("p"))), i("q"))),
      s: [["Np", T("cumulative oil produced before the shut-in", "bağlanmaya qədər toplam hasil edilmiş neft", "накопленная добыча нефти до остановки"), "stb"], S.q, S.tp],
      d: T("Horner analysis needs one number for how long the well flowed. Using cumulative oil divided by the last rate turns a variable rate history into an equivalent constant-rate time.",
           "Horner təhlili quyunun nə qədər işlədiyini göstərən bir ədəd tələb edir. Toplam neftin son debitə bölünməsi dəyişkən debit tarixçəsini ekvivalent sabit debit müddətinə çevirir.",
           "Для анализа Хорнера нужно одно время работы скважины. Накопленная добыча, делённая на последний дебит, превращает переменную историю дебита в эквивалентное время при постоянном дебите."),
      w: { page: "pta", focus: "extra" }, kw: "horner time producing tp np" },
    { id: "agarwal", g: "pta", t: T("Agarwal equivalent time", "Agarval ekvivalent vaxtı", "Эквивалентное время Агарвала"),
      f: M(sb(r(D, i("t")), tx("e")), eq, fr(r(tp, x, D, i("t")), r(tp, pl, D, i("t")))),
      s: [S.tp, S.dt],
      d: T("Makes a build-up look like a drawdown, so the log-log derivative can be read with drawdown type curves. PetroNova computes the derivative on this time.",
           "Bərpa əyrisini depressiya əyrisinə bənzədir ki, log-log törəməsini standart tip-əyrilərlə oxumaq olsun. PetroNova törəməni bu vaxt üzrə hesablayır.",
           "Делает КВД похожей на кривую падения, чтобы log-log производную можно было читать по типовым кривым. PetroNova считает производную по этому времени."),
      w: { page: "pta", focus: "c-loglog" }, kw: "agarwal equivalent time build-up" },
    { id: "horner", g: "pta", t: T("Horner plot: slope m and P*", "Horner qrafiki: meyl m və P*", "График Хорнера: наклон m и P*"),
      f: M(i("X"), eq, log(fr(r(tp, pl, D, i("t")), r(D, i("t")))), o(","), o("&#x2003;"), i("p"), eq, ps, mi, i("m"), x, i("X")),
      s: [S.tp, S.dt, S.m, S.ps],
      d: T("During radial flow the shut-in pressure falls on a straight line against X. Its slope m gives permeability; the line at X = 0 (infinite shut-in) is P*. PetroNova fits the line only inside the radial-flow window found on the derivative.",
           "Radial axın zamanı bağlanma təzyiqi X-ə qarşı düz xətt üzərində olur. Meyl m keçiriciliyi verir; X = 0 nöqtəsində (sonsuz bağlanma) xətt P*-dir. PetroNova xətti yalnız törəmədə tapılan radial axın pəncərəsində qurur.",
           "При радиальном притоке давление ложится на прямую по X. Наклон m даёт проницаемость, значение при X = 0 (бесконечная остановка) — P*. PetroNova строит прямую только в окне радиального притока, найденном по производной."),
      w: { page: "pta", focus: "c-horner" }, kw: "horner semilog slope p* straight line" },
    { id: "p1hr", g: "pta", t: T("Pressure at one hour, p1hr", "Bir saatdakı təzyiq, p1hr", "Давление через 1 час, p1hr"),
      f: M(p1, eq, ps, mi, i("m"), x, log(fr(r(tp, pl, n(1)), n(1)))),
      s: [S.ps, S.m, S.tp],
      d: T("The Horner line read at Δt = 1 hour. It is used in the skin equation instead of a measured pressure, because at 1 hour the well may still be in wellbore storage.",
           "Horner xəttinin Δt = 1 saatdakı dəyəri. Skin tənliyində ölçülmüş təzyiq əvəzinə istifadə olunur, çünki 1 saatda quyu hələ quyu tutumu təsirində ola bilər.",
           "Значение прямой Хорнера при Δt = 1 ч. Используется в формуле скина вместо замера, потому что через час скважина может ещё находиться под влиянием ствола."),
      w: { page: "pta", focus: "extra" }, kw: "p1hr one hour pressure" },
    { id: "k", g: "pta", t: T("Permeability from the Horner slope", "Horner meylindən keçiricilik", "Проницаемость по наклону Хорнера"),
      f: M(i("k"), eq, fr(r(n("162.6"), x, i("q"), x, i("B"), x, i("μ")), r(i("m"), x, i("h")))),
      s: [S.k, S.q, S.B, S.mu, S.m, S.h],
      d: T("A steeper Horner line (bigger m) means the pressure needs longer to recover, so the rock is tighter. 162.6 is the field-unit constant for radial flow.",
           "Daha dik Horner xətti (böyük m) təzyiqin gec bərpa olunduğunu, yəni süxurun daha sıx olduğunu göstərir. 162.6 radial axın üçün mədən vahidlərində sabitdir.",
           "Более крутая прямая Хорнера (большой m) значит, что давление восстанавливается медленнее, т.е. порода менее проницаема. 162.6 — константа радиального притока в промысловых единицах."),
      w: { page: "pta", focus: "r-k-a" }, calc: "k", kw: "permeability k md horner" },
    { id: "skin", g: "pta", t: T("Skin factor", "Skin əmsalı", "Скин-фактор"),
      f: M(i("S"), eq, n("1.1513"), x, bk(fr(r(p1, mi, pwf), i("m")), mi, log(fr(i("k"), r(i("φ"), x, i("μ"), x, ct, x, sp(rw, n(2))))), pl, n("3.2275"))),
      s: [S.S, S.p1, S.pwf, S.m, S.k, S.phi, S.mu, S.ct, S.rw],
      d: T("Skin measures how blocked (S > 0) or stimulated (S < 0) the rock right around the well is. PetroNova calls S > 3 damaged, S > 0.5 mildly damaged and S < −1 stimulated.",
           "Skin quyu ətrafındakı süxurun nə qədər tıxandığını (S > 0) və ya stimullaşdırıldığını (S < 0) göstərir. PetroNova S > 3 olanda zədələnmiş, S > 0.5 olanda zəif zədələnmiş, S < −1 olanda stimullaşdırılmış hesab edir.",
           "Скин показывает, насколько закупорена (S > 0) или стимулирована (S < 0) порода у скважины. PetroNova считает S > 3 повреждением, S > 0.5 слабым повреждением, S < −1 стимуляцией."),
      w: { page: "pta", focus: "r-s-a" }, calc: "skin", kw: "skin damage stimulation" },
    { id: "dps", g: "pta", t: T("Pressure drop caused by skin", "Skinin yaratdığı təzyiq düşküsü", "Депрессия из-за скина"),
      f: M(dps, eq, n("0.869"), x, i("m"), x, i("S")),
      s: [S.dps, S.m, S.S],
      d: T("How many psi of drawdown are lost in the damaged zone. Removing the damage (e.g. acid) gives this pressure back to the well as extra rate.",
           "Zədələnmiş zonada nə qədər psi depressiyanın itdiyini göstərir. Zədənin aradan qaldırılması (məs. turşu ilə) bu təzyiqi quyuya əlavə debit kimi qaytarır.",
           "Сколько psi депрессии теряется в загрязнённой зоне. Устранение загрязнения (например, кислотой) возвращает это давление скважине в виде дополнительного дебита."),
      w: { page: "pta", focus: "r-dps-a" }, calc: "skin", kw: "skin pressure drop dp" },
    { id: "fe", g: "pta", t: T("Flow efficiency", "Axın səmərəliliyi", "Гидродинамическое совершенство"),
      f: M(i("FE"), eq, fr(r(ps, mi, pwf, mi, dps), r(ps, mi, pwf))),
      s: [S.FE, S.ps, S.pwf, S.dps],
      d: T("Share of the well's undamaged potential it actually delivers. FE = 0.68 means the well flows 68 % of what it could without skin.",
           "Quyunun zədəsiz potensialının nə qədərini verdiyini göstərir. FE = 0.68 quyunun skinsiz mümkün debitin 68 %-ni verdiyi deməkdir.",
           "Доля потенциала скважины без скина, которую она реально даёт. FE = 0.68 значит 68 % от возможного дебита без скина."),
      w: { page: "pta", focus: "extra" }, calc: "skin", kw: "flow efficiency fe" },
    { id: "rinv", g: "pta", t: T("Radius of investigation", "Tədqiqat radiusu", "Радиус исследования"),
      f: M(sb(i("r"), tx("inv")), eq, sq(fr(r(i("k"), x, D, i("t")), r(n(948), x, i("φ"), x, i("μ"), x, ct)))),
      s: [["r inv", T("how far into the reservoir the test has 'seen'", "testin layın nə qədər dərinliyini 'gördüyü'", "насколько далеко в пласт 'заглянуло' исследование"), "ft"], S.k, S.dt, S.phi, S.mu, S.ct],
      d: T("A longer shut-in or a more permeable rock reaches further. PetroNova uses the last Δt of the build-up; with the time the derivative leaves the plateau it also estimates the distance to a boundary.",
           "Daha uzun bağlanma və ya daha keçirici süxur daha uzağa çatır. PetroNova bərpanın son Δt-ni istifadə edir; törəmənin platodan çıxdığı vaxtla sərhədə qədər məsafəni də qiymətləndirir.",
           "Чем дольше остановка или выше проницаемость, тем дальше радиус. PetroNova берёт последнее Δt КВД, а по времени ухода производной с плато оценивает расстояние до границы."),
      w: { page: "pta", focus: "extra" }, calc: "rinv", kw: "radius investigation boundary distance" },
    { id: "cws", g: "pta", t: T("Wellbore storage coefficient", "Quyu tutumu əmsalı", "Коэффициент влияния ствола"),
      f: M(i("C"), eq, fr(r(i("q"), x, i("B"), x, D, i("t")), r(n(24), x, D, i("p")))),
      s: [["C", T("wellbore storage", "quyu tutumu", "влияние ствола скважины"), "bbl/psi"], S.q, S.B, S.dt, ["Δp", T("pressure rise since shut-in", "bağlanmadan sonrakı təzyiq artımı", "рост давления после остановки"), "psi"]],
      d: T("Right after shut-in the fluid in the tubing is still being compressed, so early pressure is not yet the reservoir. On the log-log plot this is the unit-slope part; the radial window starts after it.",
           "Bağlanmadan dərhal sonra borulardakı maye hələ sıxılır, ona görə erkən təzyiq hələ layı göstərmir. Log-log qrafikində bu vahid meyilli hissədir; radial pəncərə ondan sonra başlayır.",
           "Сразу после остановки жидкость в НКТ ещё сжимается, поэтому раннее давление — ещё не пласт. На log-log это участок с единичным наклоном; окно радиального притока начинается после него."),
      w: { page: "pta", focus: "c-loglog" }, kw: "wellbore storage unit slope" },
    { id: "bourdet", g: "pta", t: T("Bourdet pressure derivative", "Bourdet təzyiq törəməsi", "Производная давления Бурде"),
      f: M(sp(i("p"), o("′")), eq, fr(r(i("d"), D, i("p")), r(i("d"), ln(sb(r(D, i("t")), tx("e"))))), o("≈"),
           fr(r(fr(r(D, sb(i("p"), tx("L"))), r(D, sb(i("x"), tx("L")))), x, D, sb(i("x"), tx("R")), pl, fr(r(D, sb(i("p"), tx("R"))), r(D, sb(i("x"), tx("R")))), x, D, sb(i("x"), tx("L"))),
              r(D, sb(i("x"), tx("L")), pl, D, sb(i("x"), tx("R"))))),
      s: [["p′", T("pressure derivative", "təzyiq törəməsi", "производная давления"), "psi"], ["L, R", T("neighbour points 0.1 log cycle to the left and right", "0.1 log dövrə sola və sağa olan qonşu nöqtələr", "соседние точки на 0.1 лог. цикла слева и справа"), "–"], ["x", T("ln of Agarwal time", "Agarval vaxtının ln-i", "ln времени Агарвала"), "–"]],
      d: T("The derivative turns flow regimes into simple shapes: unit slope = storage, flat = radial flow, rising = boundary or lower mobility, falling = pressure support. PetroNova picks the radial window where the derivative is flattest (variation ≤ 2 %).",
           "Törəmə axın rejimlərini sadə formalara çevirir: vahid meyl = quyu tutumu, düz = radial axın, yüksələn = sərhəd və ya aşağı mobillik, düşən = təzyiq dəstəyi. PetroNova radial pəncərəni törəmənin ən düz olduğu yerdə seçir (dəyişkənlik ≤ 2 %).",
           "Производная превращает режимы течения в простые формы: единичный наклон — ствол, плато — радиальный приток, рост — граница или низкая подвижность, падение — поддержка давления. PetroNova берёт окно, где производная наиболее плоская (разброс ≤ 2 %)."),
      w: { page: "pta", focus: "c-loglog" }, kw: "bourdet derivative log-log diagnostic" },
    { id: "datum", g: "pta", t: T("Oil gradient and datum correction", "Neft qradiyenti və datum düzəlişi", "Градиент нефти и приведение к датуму"),
      f: M(i("g"), eq, n("0.433"), x, fr(n("141.5"), r(n("131.5"), pl, i("API"))), o(","), o("&#x2003;"), sb(i("P"), tx("datum")), eq, sb(i("P"), tx("gauge")), pl, i("g"), x, p(sb(i("D"), tx("datum")), mi, sb(i("D"), tx("gauge")))),
      s: [["g", T("oil pressure gradient", "neftin təzyiq qradiyenti", "градиент давления нефти"), "psi/ft"], ["API", T("oil gravity from well tests", "quyu sınaqlarından neftin API sıxlığı", "плотность нефти в °API по замерам"), "°API"], ["D", T("true vertical depth of datum and gauge", "datum və manometrin şaquli dərinliyi", "вертикальная глубина датума и манометра"), "ft TVD"]],
      d: T("The gauge sits above the reservoir datum. Adding the oil column between them makes pressures from different wells comparable.",
           "Manometr lay datumundan yuxarıdadır. Aradakı neft sütununun əlavə edilməsi müxtəlif quyuların təzyiqlərini müqayisə edilə bilən edir.",
           "Манометр стоит выше датума пласта. Добавление столба нефти между ними делает давления разных скважин сопоставимыми."),
      w: { page: "pta", focus: "extra" }, kw: "gradient datum api correction" },

    { id: "wc", g: "prod", t: T("Water cut, GOR and GLR", "Sululuq, GOR və GLR", "Обводнённость, ГФ и ГЖФ"),
      f: M(i("WC"), eq, fr(sb(i("q"), tx("w")), r(sb(i("q"), tx("o")), pl, sb(i("q"), tx("w")))), x, n(100), o(","), o("&#x2003;"), i("GOR"), eq, fr(sb(i("q"), tx("g")), sb(i("q"), tx("o"))), o(","), o("&#x2003;"), i("GLR"), eq, fr(r(sb(i("q"), tx("g")), pl, sb(i("q"), tx("lift"))), r(sb(i("q"), tx("o")), pl, sb(i("q"), tx("w"))))),
      s: [["qo, qw", T("oil and water rates", "neft və su debitləri", "дебиты нефти и воды"), "stb/d"], ["qg, qlift", T("produced gas and injected lift gas", "hasil olunan qaz və vurulan qazlift qazı", "добытый газ и закачиваемый газлифтный газ"), "Mscf/d"]],
      d: T("Basic ratios used on every page. PetroNova flags a water-cut rise of more than 3 points (alarm above 8).",
           "Bütün səhifələrdə istifadə olunan əsas nisbətlər. PetroNova sululuğun 3 bənddən çox artmasını qeyd edir (8-dən yuxarı həyəcan).",
           "Основные соотношения, используемые на всех страницах. PetroNova отмечает рост обводнённости более чем на 3 пункта (тревога выше 8)."),
      w: { page: "overview", focus: "k-wc-f" }, kw: "water cut gor glr ratio" },
    { id: "vfm", g: "prod", t: T("VFM model (physics-hybrid)", "VFM modeli (fizika-hibrid)", "Модель VFM (физико-гибридная)"),
      f: M(ln(sb(i("q"), tx("oil"))), eq, tx("well level + trend + learned effects"), mi, i("λ"), x, fr(r(pwf, mi, sb(i("p"), tx("wf, 15 d"))), i("drawdown")), o(";"), o("&#x2003;"), sb(i("q"), tx("w")), eq, sb(i("q"), tx("o")), x, i("WOR"), o(","), o("&#x2003;"), sb(i("q"), tx("g")), eq, sb(i("q"), tx("o")), x, i("GOR")),
      s: [["λ", T("IPR strength learned from well tests (physics says 1.0; tests give 0.86)", "quyu sınaqlarından öyrənilmiş IPR gücü (fizika 1.0 deyir; sınaqlar 0.86 verir)", "сила IPR по замерам (физика даёт 1.0, замеры — 0.86)"), "–"], ["pwf, 15 d", T("15-day centred median of pwf", "pwf-in 15 günlük mərkəzləşdirilmiş medianı", "15-суточная центрированная медиана pwf"), "psia"], S.dd],
      d: T("If bottom-hole pressure rises above its slow trend, inflow falls by about ΔP/drawdown: the inflow-performance (IPR) physics. Water and gas follow oil through learned ratios. Daily rates are blended with neighbours on days with poor sensor coverage.",
           "Quyudibi təzyiq yavaş meyldən yuxarı qalxanda axın təxminən ΔP/depressiya qədər azalır: bu, axın xarakteristikası (IPR) fizikasıdır. Su və qaz öyrənilmiş nisbətlərlə neftə tabe olur. Sensor məlumatı zəif olan günlərdə debitlər qonşu günlərlə qarışdırılır.",
           "Если забойное давление выше медленного тренда, приток падает примерно на ΔP/депрессию — это физика IPR. Вода и газ следуют за нефтью через обученные соотношения. В дни с плохим покрытием датчиков дебиты смешиваются с соседними днями."),
      w: { page: "vfm", focus: "vfm-chart" }, kw: "vfm model ipr lambda virtual flow meter" },
    { id: "decline", g: "prod", t: T("Decline rate and 90-day forecast", "Azalma sürəti və 90 günlük proqnoz", "Темп падения и прогноз на 90 дней"),
      f: M(ln(i("q")), eq, i("a"), pl, i("b"), x, i("t"), o(","), o("&#x2003;"), tx("decline"), eq, p(sp(i("e"), r(n(365), x, i("b"))), mi, n(1)), x, n(100), o(","), o("&#x2003;"), sb(i("q"), tx("90")), eq, sb(i("q"), tx("now")), x, sp(p(n(1), pl, fr(tx("decline"), n(100))), fr(n(90), n(365)))),
      s: [["b", T("slope of ln(oil rate) per day, producing days only", "ln(neft debiti)-nin gündəlik meyli, yalnız işləyən günlər", "наклон ln(дебита нефти) за сутки, только рабочие дни"), "1/d"], ["decline", T("change per year (negative = falling)", "illik dəyişmə (mənfi = azalma)", "изменение за год (минус = падение)"), "%/yr"]],
      d: T("An exponential fit to producing days. Faster than −25 %/yr is flagged as fast decline on the Problems page.",
           "İşləyən günlərə eksponensial uyğunlaşdırma. −25 %/il-dən sürətli azalma Problemlər səhifəsində sürətli azalma kimi qeyd olunur.",
           "Экспоненциальная аппроксимация рабочих дней. Падение быстрее −25 %/год отмечается на странице «Проблемы»."),
      w: { page: "overview", focus: "field-chart" }, kw: "decline forecast exponential arps" },
    { id: "whatif", g: "prod", t: T("What-if: lift gas and choke", "Ssenari: qazlift və ştuser", "Сценарий: газлифт и штуцер"),
      f: M(D, ln(i("q")), eq, mi, fr(r(D, pwf), i("drawdown")), pl, i("c"), x, D, i("choke"), o(","), o("&#x2003;"), r(D, pwf), eq, i("s"), x, D, sb(i("Q"), tx("lift")), o(","), o("&#x2003;"), sb(i("q"), tx("new")), eq, i("q"), x, sp(i("e"), r(D, ln(i("q"))))),
      s: [["s", T("pwf change per Mscf/d of lift gas, measured on the 14-Jun lift-gas outage", "14 iyun qazlift kəsilməsində ölçülmüş, hər Mscf/d qazlift üçün pwf dəyişməsi", "изменение pwf на 1 Mscf/d газлифта по отключению 14 июня"), "psi per Mscf/d"], ["c", T("choke effect learned by the VFM model (per % opening)", "VFM modelinin öyrəndiyi ştuser təsiri (hər % açılma üçün)", "влияние штуцера по модели VFM (на 1 % открытия)"), "1/%"], S.dd],
      d: T("More lift gas lowers pwf, which raises inflow through the IPR; opening the choke adds the learned choke effect. Water and gas change in the same ratio. Valid for ±10 choke points and ±50 % lift gas.",
           "Daha çox qazlift pwf-i azaldır və IPR vasitəsilə axını artırır; ştuserin açılması öyrənilmiş ştuser təsirini əlavə edir. Su və qaz eyni nisbətdə dəyişir. ±10 ştuser bəndi və ±50 % qazlift üçün etibarlıdır.",
           "Больше газлифта снижает pwf и через IPR увеличивает приток; открытие штуцера добавляет обученный эффект штуцера. Вода и газ меняются в той же пропорции. Действительно для ±10 пунктов штуцера и ±50 % газлифта."),
      w: { page: "whatif", focus: "c-wf" }, kw: "what-if lift gas choke scenario" },
    { id: "gain", g: "prod", t: T("Stimulation gain and money lost", "Stimullaşdırma qazancı və itirilən gəlir", "Прирост от стимуляции и потерянные деньги"),
      f: M(sb(i("q"), tx("gain")), eq, i("q"), x, p(fr(n(1), i("FE")), mi, n(1)), o(","), o("&#x2003;"), tx("$ lost"), eq, sb(i("q"), tx("oil, lost")), x, sb(i("P"), tx("oil")), pl, sb(i("q"), tx("gas, lost")), x, sb(i("P"), tx("gas"))),
      s: [S.FE, ["q", T("current oil rate", "cari neft debiti", "текущий дебит нефти"), "stb/d"], ["P oil, P gas", T("prices set on the Problems page", "Problemlər səhifəsində verilən qiymətlər", "цены со страницы «Проблемы»"), "$/bbl, $/Mscf"]],
      d: T("If skin were removed (FE → 1) the well would produce q/FE. PetroNova counts damage as a problem when S > 1.5 and FE < 1 (alarm when S > 5). Lost gas is lost oil × GOR.",
           "Skin aradan qaldırılsaydı (FE → 1) quyu q/FE hasil edərdi. PetroNova S > 1.5 və FE < 1 olanda zədəni problem sayır (S > 5 olanda həyəcan). İtirilən qaz = itirilən neft × GOR.",
           "Если убрать скин (FE → 1), скважина дала бы q/FE. PetroNova считает повреждение проблемой при S > 1.5 и FE < 1 (тревога при S > 5). Потерянный газ = потерянная нефть × ГФ."),
      w: { page: "problems", focus: "pb-well-chart" }, calc: "gain", kw: "stimulation acid gain money loss price" },
  ];

  // ---------- reference plots (drawn in pages/others.js)
  const PLOTS = [
    { id: "pl-loglog", t: T("Log-log diagnostic patterns", "Log-log diaqnostik nümunələri", "Диагностические формы log-log"),
      d: T("Compare the shape of the derivative with your well's log-log plot. Unit slope early = wellbore storage; flat = radial flow (use this part for k and skin); late rise or fall tells what the reservoir does at a distance.",
           "Törəmənin formasını quyunuzun log-log qrafiki ilə müqayisə edin. Erkən vahid meyl = quyu tutumu; düz hissə = radial axın (k və skin üçün bu hissəni istifadə edin); gec yüksəlmə və ya düşmə uzaqda layın davranışını göstərir.",
           "Сравните форму производной с log-log вашей скважины. Ранний единичный наклон — ствол; плато — радиальный приток (по нему k и скин); поздний рост или падение показывает поведение пласта вдали."), kw: "log-log derivative type curve fault boundary storage radial" },
    { id: "pl-horner", t: T("Horner plot", "Horner qrafiki", "График Хорнера"),
      d: T("Points on the straight part give m (slope) and P* (line at X = 0). Early points bend away because of wellbore storage; do not fit them.",
           "Düz hissədəki nöqtələr m (meyl) və P* (X = 0-da xətt) verir. Erkən nöqtələr quyu tutumu səbəbindən əyilir; onları uyğunlaşdırmayın.",
           "Точки на прямом участке дают m (наклон) и P* (прямая при X = 0). Ранние точки отклоняются из-за ствола — их не используют."), kw: "horner semilog p* slope" },
    { id: "pl-ipr", t: T("Inflow performance (IPR): straight line and Vogel", "Axın xarakteristikası (IPR): düz xətt və Vogel", "Индикаторная кривая (IPR): прямая и Вогель"),
      d: T("Above the bubble point rate grows in a straight line with drawdown (productivity index). Below it, free gas makes extra drawdown less effective: the Vogel curve.",
           "Doyma təzyiqindən yuxarıda debit depressiya ilə düz xətt üzrə artır (məhsuldarlıq əmsalı). Ondan aşağıda sərbəst qaz əlavə depressiyanı daha az effektiv edir: Vogel əyrisi.",
           "Выше давления насыщения дебит растёт линейно с депрессией (коэффициент продуктивности). Ниже — свободный газ снижает эффект депрессии: кривая Вогеля."), kw: "ipr vogel productivity index bubble point inflow" },
    { id: "pl-decline", t: T("Decline curves (Arps)", "Azalma əyriləri (Arps)", "Кривые падения (Арпс)"),
      d: T("Exponential (b = 0) falls fastest, harmonic (b = 1) slowest. PetroNova fits the exponential form to recent producing days.",
           "Eksponensial (b = 0) ən sürətli, harmonik (b = 1) ən yavaş azalır. PetroNova son işləyən günlərə eksponensial formanı uyğunlaşdırır.",
           "Экспоненциальная (b = 0) падает быстрее всего, гармоническая (b = 1) — медленнее. PetroNova использует экспоненциальную форму по рабочим дням."), kw: "decline arps exponential hyperbolic harmonic forecast" },
    { id: "pl-skin", t: T("Pressure around the well, with and without skin", "Quyu ətrafında təzyiq, skinlə və skinsiz", "Давление вокруг скважины со скином и без"),
      d: T("A damaged zone near the wellbore adds a sharp extra pressure drop (ΔP skin). The rest of the reservoir looks the same.",
           "Quyu yaxınlığındakı zədələnmiş zona əlavə kəskin təzyiq düşküsü (ΔP skin) yaradır. Layın qalan hissəsi eyni görünür.",
           "Загрязнённая зона у ствола даёт резкую дополнительную депрессию (ΔP skin). Остальной пласт выглядит так же."), kw: "skin pressure profile damaged zone radial" },
    { id: "pl-gaslift", t: T("Gas-lift performance curve", "Qazlift xarakteristikası", "Характеристика газлифта"),
      d: T("More lift gas helps until friction wins: oil rate peaks, then falls. Work near the economic optimum, a little left of the peak.",
           "Daha çox qazlift sürtünmə üstün gələnə qədər kömək edir: neft debiti maksimuma çatır, sonra düşür. Pikdən bir az solda, iqtisadi optimum yaxınlığında işləyin.",
           "Больше газлифта помогает, пока не возобладает трение: дебит нефти достигает максимума и падает. Работайте у экономического оптимума, чуть левее пика."), kw: "gas lift performance curve optimum injection" },
  ];

  // ---------- calculators (computed in pages/others.js)
  const CALC = [
    { id: "calc-k", t: T("Permeability from Horner slope", "Horner meylindən keçiricilik", "Проницаемость по наклону Хорнера"), eq: "k", kw: "calculator permeability k" },
    { id: "calc-skin", t: T("Skin, ΔP skin and flow efficiency", "Skin, ΔP skin və axın səmərəliliyi", "Скин, ΔP скина и совершенство"), eq: "skin", kw: "calculator skin flow efficiency" },
    { id: "calc-rinv", t: T("Radius of investigation", "Tədqiqat radiusu", "Радиус исследования"), eq: "rinv", kw: "calculator radius investigation" },
    { id: "calc-gain", t: T("Stimulation gain", "Stimullaşdırma qazancı", "Прирост от стимуляции"), eq: "gain", kw: "calculator stimulation gain money" },
    { id: "calc-units", t: T("Unit converter", "Vahid çevirici", "Конвертер единиц"), kw: "unit converter conversion psi bar kgf md darcy cp" },
  ];

  // ---------- glossary: term, definition, linked equation
  const GL = [
    ["Annulus pressure", T("Pressure in the space between tubing and casing, where lift gas is injected.", "Qazlift qazı vurulan, boru ilə kəmər arasındakı fəzadakı təzyiq.", "Давление в затрубье, куда закачивается газлифтный газ."), null],
    ["API gravity", T("Oil density scale; higher API = lighter oil.", "Neft sıxlığı şkalası; yüksək API = yüngül neft.", "Шкала плотности нефти; выше API — легче нефть."), "datum"],
    ["Bourdet derivative", T("Pressure derivative versus log-time that turns flow regimes into simple shapes.", "Axın rejimlərini sadə formalara çevirən, log-vaxta görə təzyiq törəməsi.", "Производная давления по логарифму времени, показывающая режимы течения."), "bourdet"],
    ["Bubble point (Pb)", T("Pressure below which gas comes out of the oil.", "Bundan aşağı təzyiqdə qazın neftdən ayrıldığı təzyiq.", "Давление, ниже которого из нефти выделяется газ."), null],
    ["Build-up test", T("Shutting a well in and recording how pressure recovers; analysed by PTA.", "Quyunu bağlayıb təzyiqin bərpasını qeyd etmək; PTA ilə təhlil olunur.", "Остановка скважины с записью восстановления давления (КВД); анализируется в ГДИС."), "horner"],
    ["Choke", T("Adjustable restriction at the wellhead that controls rate; given in % opening.", "Quyu ağzında debiti idarə edən tənzimlənən daralma; açılma %-i ilə verilir.", "Регулируемый штуцер на устье, управляющий дебитом; задаётся в % открытия."), "whatif"],
    ["Compressibility (ct)", T("How much rock and fluids shrink per psi of pressure increase.", "Süxur və mayelərin hər psi təzyiq artımında nə qədər sıxıldığı.", "Насколько сжимаются порода и флюиды на 1 psi роста давления."), "skin"],
    ["Datum", T("Reference depth to which pressures are corrected so wells can be compared.", "Quyuları müqayisə etmək üçün təzyiqlərin gətirildiyi istinad dərinliyi.", "Опорная глубина, к которой приводят давления для сравнения скважин."), "datum"],
    ["Decline", T("Rate of production fall over time, here in % per year.", "Hasilatın zamanla azalma sürəti, burada illik %.", "Темп снижения добычи во времени, здесь в % в год."), "decline"],
    ["Drawdown", T("Reservoir pressure minus flowing bottom-hole pressure; what pushes oil into the well.", "Lay təzyiqi minus quyudibi işçi təzyiq; nefti quyuya itələyən fərq.", "Пластовое минус забойное давление; то, что гонит нефть в скважину."), "vfm"],
    ["Flow efficiency (FE)", T("Share of the undamaged potential a well delivers.", "Quyunun zədəsiz potensialdan verdiyi pay.", "Доля потенциала без скина, которую даёт скважина."), "fe"],
    ["FVF (B)", T("Formation volume factor: reservoir barrels per stock-tank barrel.", "Həcm əmsalı: bir səth barelinə düşən lay bareli.", "Объёмный коэффициент: пластовых баррелей на баррель в поверхностных условиях."), "k"],
    ["Gas lift", T("Injecting gas into the tubing to lighten the fluid column and raise rate.", "Maye sütununu yüngülləşdirib debiti artırmaq üçün boruya qaz vurulması.", "Закачка газа в НКТ для облегчения столба жидкости и роста дебита."), "whatif"],
    ["GLR", T("Gas-liquid ratio including injected lift gas.", "Vurulan qazlift qazı daxil olmaqla qaz-maye nisbəti.", "Газожидкостный фактор с учётом газлифтного газа."), "wc"],
    ["GOR", T("Produced gas per barrel of oil.", "Hər barel neftə düşən hasil olunan qaz.", "Добытый газ на баррель нефти (газовый фактор)."), "wc"],
    ["Horner plot", T("Shut-in pressure versus log((tp+Δt)/Δt); straight in radial flow.", "Bağlanma təzyiqi log((tp+Δt)/Δt)-ə qarşı; radial axında düz xətt.", "Давление остановки против log((tp+Δt)/Δt); прямая при радиальном притоке."), "horner"],
    ["IPR", T("Inflow performance relationship: rate versus bottom-hole pressure.", "Axın xarakteristikası: debitin quyudibi təzyiqdən asılılığı.", "Индикаторная зависимость дебита от забойного давления."), "vfm"],
    ["MAPE", T("Mean absolute percentage error; how the VFM is scored against well tests.", "Orta mütləq faiz xətası; VFM-in quyu sınaqları ilə qiymətləndirilməsi.", "Средняя абсолютная ошибка в %; оценка VFM по замерам."), null],
    ["Net pay (h)", T("Thickness of the reservoir that actually produces.", "Layın faktiki hasilat verən qalınlığı.", "Толщина пласта, реально отдающая флюид."), "k"],
    ["P*", T("Horner line extrapolated to infinite shut-in time.", "Sonsuz bağlanma vaxtına ekstrapolyasiya edilmiş Horner xətti.", "Прямая Хорнера, экстраполированная на бесконечное время."), "horner"],
    ["p1hr", T("Horner-line pressure at one hour after shut-in.", "Bağlanmadan bir saat sonra Horner xəttindəki təzyiq.", "Давление на прямой Хорнера через 1 час."), "p1hr"],
    ["Permeability (k)", T("How easily fluid flows through the rock, in millidarcy.", "Mayenin süxurdan nə qədər asan axdığı, millidarsi ilə.", "Насколько легко флюид течёт через породу, в мД."), "k"],
    ["Porosity (φ)", T("Fraction of rock volume that is pore space.", "Süxur həcminin məsamə olan hissəsi.", "Доля объёма породы, занятая порами."), "skin"],
    ["PTA", T("Pressure transient analysis: reading reservoir properties from pressure changes.", "Təzyiq dəyişmələrindən lay xassələrinin təyini.", "Гидродинамические исследования: свойства пласта по изменению давления."), "horner"],
    ["Pwf", T("Flowing bottom-hole pressure.", "Quyudibi işçi təzyiq.", "Забойное давление при работе."), "skin"],
    ["Radial flow", T("Flow converging evenly to the well; flat derivative; used for k and skin.", "Quyuya bərabər yığılan axın; düz törəmə; k və skin üçün istifadə olunur.", "Равномерный приток к скважине; плато производной; по нему k и скин."), "bourdet"],
    ["Radius of investigation", T("How far into the reservoir a test has reached.", "Testin layda nə qədər uzağa çatdığı.", "Насколько далеко в пласт дошло исследование."), "rinv"],
    ["Shut-in", T("Period when the well is closed; build-ups are taken from shut-ins.", "Quyunun bağlı olduğu dövr; bərpa testləri bağlanmalardan götürülür.", "Период, когда скважина закрыта; КВД берутся из остановок."), "tp"],
    ["Skin (S)", T("Extra resistance (S > 0) or stimulation (S < 0) right around the well.", "Quyu ətrafında əlavə müqavimət (S > 0) və ya stimullaşdırma (S < 0).", "Дополнительное сопротивление (S > 0) или стимуляция (S < 0) у скважины."), "skin"],
    ["Tp", T("Equivalent producing time before the shut-in.", "Bağlanmadan əvvəlki ekvivalent hasilat müddəti.", "Эквивалентное время работы до остановки."), "tp"],
    ["VFM", T("Virtual flow meter: rates estimated from sensors instead of a physical meter.", "Virtual sərfölçən: debitlərin fiziki sayğac əvəzinə sensorlardan hesablanması.", "Виртуальный расходомер: дебиты по датчикам вместо физического счётчика."), "vfm"],
    ["Viscosity (μ)", T("Resistance of the oil to flow, in centipoise.", "Neftin axına müqaviməti, santipuaz ilə.", "Сопротивление нефти течению, в сП."), "k"],
    ["Water cut", T("Water share of the produced liquid, in %.", "Hasil olunan mayedə suyun payı, %.", "Доля воды в добываемой жидкости, %."), "wc"],
    ["Wellbore storage", T("Early shut-in period when fluid in the tubing is still compressing.", "Bağlanmanın erkən dövrü, boruda maye hələ sıxılır.", "Ранний период остановки, когда жидкость в НКТ ещё сжимается."), "cws"],
    ["WHP", T("Wellhead pressure.", "Quyu ağzı təzyiqi.", "Устьевое давление."), null],
  ].map(([term, def, eqId]) => ({ term, def, eq: eqId }));

  window.OTHERS = { G, EQ, PLOTS, CALC, GL, SYM: S };

  // titles go into the shared dictionary, so the top-bar search finds them on every page
  const add = (key, tt) => ["en", "az", "ru"].forEach(l => { if (window.I18N && window.I18N[l]) window.I18N[l][key] = tt[l]; });
  EQ.forEach(e => add("oth_" + e.id, e.t));
  PLOTS.forEach(e => add("oth_" + e.id, e.t));
  CALC.forEach(e => add("oth_" + e.id, e.t));
})();
