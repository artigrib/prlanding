# Круглый стол по тексту лендинга printedrobotics.cz

> Это **симуляция точек зрения** (условные персонажи), а не мнения реальных людей.
> Факты взяты только из репозитория artigrib/prlanding. Цифры трекшна, которых в репозитории нет, отмечены **[doplnit]**.

## Опорные факты (из репо)
- 168 open-source робот-проектов в реестре, 16 категорий, у каждого проекта: лицензии, BOM-цена, зрелость, fit для maker/school/lab, проверенные источники (поле `checked`).
- 30 3D-моделей (GLB) с атрибуцией лицензий; разложенный вид деталей из оригинальных STL.
- Физическая симуляция SO-101 в браузере (мышью и пальцем), 10 миссий, запись и повтор движения «как при обучении с LeRobot».
- Арена боевых роботов до 150 г в браузере.
- Сборка: 7 этапов, оценка 10–19 часов; план закупки у поставщиков с проверенными ценами и проверкой вариантов сервоприводов.
- MCP: Claude или другой ассистент управляет симулированной SO-101; есть бенчмарк управления (bench/).
- Агентный пайплайн backend/forge: пример — расширение «фонарик для SO-101» (BOM-дельта, «проверено только в симуляции»).
- Страница для школ: бесплатный урок робототехники и инструкции на чешском.
- Готовые наборы — только там, где это позволяет лицензия.
- В разработке: цифровой двойник в браузере, который будет управлять реальной SO-101.

---

## Раунд 1 — каждый пишет свою версию

### 1. Партнёр акселератора (в духе YC): ясность, проблема, «почему сейчас», трекшн, запрос
- **Hero:** «Каталог и инструкции для open-source роботов: от GitHub до робота на столе». — 168 проверенных проектов. Сначала симуляция, потом сборка.
- **Проблема:** open-source робототехника разбросана по тысячам репозиториев с неясными лицензиями, BOM и уровнем зрелости. Школы и лаборатории не знают, с чего начать.
- **Решение:** единый реестр + симуляция в браузере + пошаговая сборка + план закупки.
- **Почему сейчас:** дешёвые 3D-принтеры, LeRobot и ИИ-агенты (MCP) сделали роботов доступными, но не понятными.
- **Трекшн:** [doplnit] пользователей, [doplnit] уроков в школах, [doplnit] собранных роботов.
- **Запрос:** ищем партнёров и финансирование для [doplnit].

### 2. Продуктовый психолог (в духе Apple): одна идея на экран, эмоция, низкая когнитивная нагрузка
- Экран 1: **«Робот, которого можно собрать самому».** (Только визуал и одна фраза.)
- Экран 2: **«Сначала в браузере».** Попробуйте руку в симуляции — без покупок.
- Экран 3: **«Каждая деталь на виду».** Лицензия, цена, источник.
- Экран 4: **«Скажите, что изменить».** Агенты спроектируют и проверят.
- Экран 5: **«Для каждого класса».** Бесплатный урок на чешском.
- Экран 6: **«Вместе дальше».** Партнёрство. — Цифры и детали скрыть за «подробнее».

### 3. Эксперт по грантам / фондам ЕС: влияние, образование, open-source, измеримые результаты, соответствие CZ/EU
- **Миссия:** сделать робототехнику доступной школам и лабораториям в Чехии через открытые, проверенные проекты.
- **Влияние:** STEM-образование на чешском, бесплатный урок, снижение стоимости входа (руки от ~230 USD BOM по данным реестра).
- **Открытость и юридическая чистота:** проверка лицензий каждого проекта, атрибуция, наборы только при разрешающей лицензии.
- **Измеримые результаты:** [doplnit] школ, [doplnit] учеников, [doplnit] часов уроков; KPI на период гранта.
- **Инновации:** ИИ-агенты и бенчмарк управления, цифровой двойник.
- **Соответствие:** цифровое образование, open science, [doplnit] конкретная программа.

### 4. Практик образовательной робототехники
- **«Урок робототехники завтра — без бюджета на железо».** Симуляция работает на школьном компьютере.
- **«Потом настоящий робот».** 7 этапов, 10–19 часов, список покупок.
- **«Безопасность и честность».** Предупреждения о безопасности в каждом проекте, оценка зрелости.
- **«Для кружков и соревнований».** Арена роботов до 150 г.

---

## Раунд 2 — критика
- **YC → Apple:** красиво, но фонд не поймёт, что это за бизнес/инфраструктура. Нужна одна фраза «что это» и цифры на первом экране.
- **Apple → YC:** проблема + решение + «почему сейчас» в одном экране — это стена текста. Один экран — одна мысль; цифры — отдельной полосой.
- **Грант → всем:** нет слов «влияние», «образование», «открытые данные»; трекшн без KPI бесполезен. Нельзя обещать того, чего нет (цифровой двойник — пометить «в разработке»).
- **Практик → гранту:** «STEM-доступность» — абстракция; лучше конкретика: «бесплатный урок на чешском», «работает на школьном компьютере».
- **YC → практику:** арена — хорошо для сообщества, но для фондов вторична; убрать вниз.
- **Apple → гранту:** абзацы про соответствие программам — в PDF one-pager, не на лендинг.

## Раунд 3 — консенсус (ключевые решения)
1. **Hero = одна фраза «что это» + 3 цифры** (компромисс YC + Apple): 168 · 30 · 16.
2. **Один тезис на экран**, заголовок ≤ 7 слов, поддержка ≤ 2 строк (Apple).
3. **Порядок историй:** проблема → посмотреть в браузере → прозрачные детали → собрать → ИИ-агенты → школы → влияние/цифры → партнёрство.
4. **Честность:** всё, что не готово, помечено «připravujeme»; трекшн — [doplnit], никаких выдуманных цифр (грант).
5. **Агентная команда** — главное отличие «почему сейчас», показывается как наглядное демо с пометкой «vizualizace».
6. **Арена** — одна строка в блоке сообщества, не отдельный экран.
7. **Конкретный CTA для партнёров:** «Stáhnout one-pager» + «Domluvit schůzku»; соответствие грантовым программам — в one-pager.

---

## Итоговый текст — CS (основной)
1. **Open-source roboti. Od repozitáře k robotovi na stole.** — Ověřený katalog, simulace v prohlížeči a návod na stavbu na jednom místě. · **168** projektů · **30** 3D modelů · **16** kategorií
2. **Otevřená robotika je roztříštěná.** — Tisíce repozitářů, nejasné licence, ceny i vyspělost. Školy a laboratoře nevědí, kde začít.
3. **Nejdřív si to vyzkoušíte v prohlížeči.** — Ruka SO-101 ve fyzikální simulaci, deset misí, bez nákupu jediného dílu.
4. **Každý díl je vidět.** — Licence, cena kusovníku, zdroj a datum ověření u každého projektu.
5. **Pak robota postavíte.** — Sedm etap, 10 až 19 hodin. Víte, co koupit a kde.
6. **Řekněte, co změnit. Agenti to navrhnou.** — Agentic Engineering Team: návrh, CAD, simulace a kontrola kusovníku. Příklad: svítilna pro SO-101, ověřená v simulaci.
7. **Ruku může řídit váš AI asistent.** — MCP nástroje pro Clauda a další, s benchmarkem řízení.
8. **Robotika pro každou třídu.** — Hodina robotiky zdarma a návody česky. Simulace běží na školním počítači.
9. **Dopad, který lze měřit.** — [doplnit] škol · [doplnit] studentů · [doplnit] postavených robotů.
10. **Otevřené a poctivé.** — Hotovou sadu nabízíme jen tam, kde to licence dovoluje. Co ještě není hotové, označujeme „připravujeme“.
11. **Postavme to spolu.** — Hledáme partnery, granty a fondy pro [doplnit]. → *Stáhnout one-pager* · *Domluvit schůzku*

## Final copy — EN
1. **Open-source robots. From repository to robot on your desk.** — A verified catalogue, in-browser simulation and build guides in one place. · **168** projects · **30** 3D models · **16** categories
2. **Open robotics is fragmented.** — Thousands of repos, unclear licences, costs and maturity. Schools and labs don't know where to start.
3. **Try it in the browser first.** — The SO-101 arm in a physics simulation, ten missions, no parts bought.
4. **Every part is visible.** — Licence, BOM cost, source and verification date for each project.
5. **Then build the robot.** — Seven stages, 10–19 hours. You know what to buy and where.
6. **Say what to change. Agents design it.** — Agentic Engineering Team: design, CAD, simulation, BOM check. Example: a flashlight for SO-101, verified in simulation.
7. **Your AI assistant can drive the arm.** — MCP tools for Claude and others, with a control benchmark.
8. **Robotics for every classroom.** — A free robotics lesson and guides in Czech. The simulation runs on a school PC.
9. **Impact you can measure.** — [doplnit] schools · [doplnit] students · [doplnit] robots built.
10. **Open and honest.** — Kits only where the licence allows. Anything unfinished is marked "coming soon".
11. **Let's build it together.** — We're looking for partners, grants and funds for [doplnit]. → *Download one-pager* · *Book a meeting*


---

## Дополнение (раунд 4, симуляция): философия open source и широта каталога
Новые тезисы вставлены после «проблемы» (2 шт.) и перед «влиянием» (категории). Обоснование из репо: «Tři kroky mezi repozitářem na GitHubu a robotem na vašem stole», «Hotovou sadu jen tam, kde to licence dovoluje», бесплатная симуляция в браузере, проекты с известными сборками (`maturity.known_builds`), лицензии у каждого проекта.

- **YC:** философия = ответ на «почему вы»: низкий порог входа и доверие к проверенным конструкциям. Ставить сразу после проблемы, как мост к решению.
- **Apple:** две короткие мысли, без слова «философия»; одна про «двери открыты», вторая про «это ваш робот».
- **Грант-эксперт:** «можно починить и изменить» = устойчивость и образование; категории с числами показывают масштаб — фондам важно увидеть 16 направлений, включая лабораторную автоматизацию и биореакторы (open science).
- **Практик:** «платите только за детали» — главный аргумент для школ.
- **Решение:** 2 тезиса философии + 1 тезис-сетка «16 kategorií» со ссылками в каталог (`/katalog/rejstrik/?cat=…`, параметр проверен в assets/registry.js). Каждый тезис сопровождает свой уникальный робот с подписью «Kategorie: X · N projektů». 3D-модели есть только для 6 категорий (legged, wheeled, arm, hand, lab-automation, humanoid), поэтому категории роботов в прокрутке повторяются, но модели — нет.

### Новые тезисы — CS
- **Do robotiky bez zamčených dveří.** — Zdarma v prohlížeči, pak tisk, pak stavba. Platíte jen za díly, které opravdu potřebujete.
- **Stavíte na návrzích, které už fungují.** — Komunitou postavené a ověřené projekty. Robot je váš: upravíte ho i opravíte.
- **16 kategorií. Od kol po bioreaktor.** — Každá kategorie vede přímo do katalogu. (sítka: Robot na kolech 32 · Kráčející robot 20 · Robotická ruka 19 · Laboratorní automatizace 18 · Pohon 16 · Senzor 11 · Humanoid 10 · Robotická dlaň 7 · Chapadlo 6 · Pásový robot 6 · Bioreaktor 5 · Ostatní 5 · Převodovka 4 · Lidar 4 · Dron 3 · Výměna nástrojů 2)

### New theses — EN
- **Robotics with no locked doors.** — Free in the browser, then print, then build. You only pay for the parts you need.
- **Build on designs that already work.** — Community-built, proven projects. The robot is yours: modify it, repair it.
- **16 categories. From wheels to bioreactors.** — Each category links straight into the catalogue.

Итоговый порядок: 01 hero · 02 проблема · 03–04 философия · 05 браузер · 06 детали · 07 сборка · 08 Agentic Engineering Team · 09 ИИ-ассистент · 10 школы · 11 16 категорий · 12 влияние · 13 открытость · 14 партнёрство.
