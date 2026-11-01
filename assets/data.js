// Catalogue data: one entry per robot. Renders live in /img/<id>_<color>.jpg.
window.PR_COLORS = [
  { id: 'white', name: 'Bílá', hex: '#F2F2EE' },
  { id: 'grey', name: 'Šedá', hex: '#9A9A94' },
  { id: 'black', name: 'Černá', hex: '#2A2A2A' },
  { id: 'orange', name: 'Oranžová', hex: '#E8461E' },
  { id: 'blue', name: 'Modrá', hex: '#1F3BFF' }
];
window.PR_CATS = { arm: 'Ruce a dlaně', mobile: 'Mobilní', legged: 'Kráčející', desk: 'Stolní', combat: 'Bojoví roboti', lab: 'Laboratoř' };
window.PR_ROBOTS = [
  { id: 'so101', glb: true, sim: 'so101', name: 'SO-101', type: 'Robotická ruka', cat: 'arm', level: 'Začátečník', hw: 'Apache-2.0', sw: 'Apache-2.0',
    author: 'The Robot Studio a Hugging Face', render: true, alt: 'Robotická ruka SO-101',
    short: 'Ruka s pěti osami a chapadlem pro AI a teleoperaci s knihovnou LeRobot. Pár ovládací + výkonná ruka.',
    lead: 'Ruka s pěti osami a chapadlem pro učení robotů a teleoperaci. Ovládací ruku (leader) vedete vlastní rukou, výkonná ruka (follower) pohyb opakuje – a s knihovnou LeRobot se úlohu naučí sama.',
    bomCost: '≈ 130 USD / ruka (ceny v USA podle kusovníku projektu, bez dopravy a DPH; pro ČR viz plán nákupu)', printTime: '≈ 16,5 h za pár', software: 'LeRobot (Python)', setups: true,
    repo: 'https://github.com/TheRobotStudio/SO-ARM100', docs: 'https://huggingface.co/docs/lerobot/so101',
    card: [['Osy', '5 + chapadlo'], ['Software', 'LeRobot']],
    specs: [['Stupně volnosti', '5 os + chapadlo'], ['Pohon', 'Feetech STS3215'], ['Napájení', '5 V (serva 7,4 V); follower s 12V servy: 12 V'], ['Tisk', 'PLA+, vrstva 0,2 mm'], ['Doba tisku', '≈ 16,5 h za pár']],
    license: { hw: 'Apache-2.0', sw: 'Apache-2.0', status: 'verified', checked: '2026-10-30',
      sources: ['https://github.com/TheRobotStudio/SO-ARM100/blob/main/LICENSE', 'https://github.com/huggingface/lerobot/blob/main/LICENSE'] },
    related: ['hand', 'lekiwi', 'xle'] },
  { id: 'lekiwi', glb: true, name: 'LeKiwi', type: 'Mobilní manipulátor', cat: 'mobile', level: 'Střední', hw: 'Apache-2.0', sw: 'Apache-2.0',
    author: 'SIGRobotics UIUC', render: true, alt: 'Mobilní robot LeKiwi s omni koly a rukou SO-101',
    short: 'Holonomní tříkolová základna s rukou SO-101, Raspberry Pi 5 a dvěma kamerami.',
    lead: 'Holonomní tříkolová základna s rukou SO-101, Raspberry Pi 5 a dvěma kamerami. Pro sběr dat a teleoperaci v LeRobot.',
    bomCost: '—', printTime: '—', software: 'LeRobot (Python)',
    repo: 'https://github.com/SIGRobotics-UIUC/LeKiwi', docs: 'https://huggingface.co/docs/lerobot/lekiwi',
    card: [['Pohon', '3× omni kolo'], ['Řízení', 'Raspberry Pi 5']],
    bom: [['Raspberry Pi 5', '1×'], ['Omni kolo', '3×'], ['Serva pohonu základny', '3×'], ['Ruka SO-101: serva a řídicí deska', '1 sada'], ['Napájení 5 V nebo 12 V', '1×'], ['RGB kamera', '2×']],
    specs: [['Pohon', '3× omni kolo'], ['Řízení', 'Raspberry Pi 5'], ['Ruka', 'SO-101'], ['Kamery', '2× RGB'], ['Varianty', '5 V a 12 V']],
    license: { hw: 'Apache-2.0', sw: 'Apache-2.0', status: 'verified', checked: '2026-10-30',
      sources: ['https://github.com/SIGRobotics-UIUC/LeKiwi/blob/main/LICENSE.txt', 'https://github.com/huggingface/lerobot/blob/main/LICENSE'] },
    related: ['xle', 'hand', 'so101'] },
  { id: 'xle', glb: true, name: 'XLeRobot', type: 'Dvouruký domácí robot', cat: 'mobile', level: 'Pokročilý', hw: 'Apache-2.0 (ověřujeme)', sw: 'Apache-2.0', preparing: true,
    author: 'Gaotian Wang a kol.', render: true, alt: 'Robot XLeRobot se dvěma rukama na vozíku',
    short: 'Dvě ruce SO-101 na mobilní základně. Teleoperace přes VR či gamepad.',
    lead: 'Dvě ruce SO-101 na mobilní základně. Teleoperace přes VR nebo gamepad, výzkum sim2real.',
    bomCost: 'od 660 USD', printTime: '—', software: 'LeRobot, ManiSkill',
    repo: 'https://github.com/Vector-Wangel/XLeRobot', docs: 'https://xlerobot.readthedocs.io',
    card: [['Ruce', '2× SO-101'], ['Ovládání', 'VR, gamepad']],
    bom: [['Ruka SO-101: serva a řídicí desky', '2 sady'], ['Mobilní základna', '1×'], ['Baterie', '1×'], ['Kamery', '3×']],
    specs: [['Ruce', '2× SO-101'], ['Ovládání', 'VR, gamepad']],
    related: ['lekiwi', 'so101', 'hand'] },
  { id: 'duck', glb: true, name: 'Open Duck Mini v2', type: 'Dvounohý robot', cat: 'legged', level: 'Pokročilý', hw: 'Apache-2.0', sw: 'Apache-2.0',
    author: 'Antoine Pirrone a komunita', render: true, alt: 'Dvounohý robot Open Duck Mini v2',
    short: 'Malý chodící robot řízený RL politikou. 51 tištěných dílů včetně TPU.',
    lead: 'Malý chodící robot řízený naučenou RL politikou. 51 tištěných dílů včetně pružných chodidel z TPU.',
    bomCost: 'pod 400 USD', printTime: '—', software: 'Python, RL politika',
    repo: 'https://github.com/apirrone/Open_Duck_Mini', docs: 'https://github.com/apirrone/Open_Duck_Mini',
    card: [['Výška', '≈ 42 cm'], ['Řízení', 'RPi Zero 2W']],
    bom: [['Serva Feetech (nohy a krk)', 'dle BOM'], ['Raspberry Pi Zero 2W', '1×'], ['IMU', '1×'], ['Baterie', '1×'], ['Ložiska', '1 sada']],
    specs: [['Výška', '≈ 42 cm'], ['Řízení', 'RPi Zero 2W'], ['Tištěné díly', '51 (PLA + TPU)'], ['Chůze', 'RL politika']],
    related: ['spot', 'otto', 'so101'] },
  { id: 'hand', glb: true, name: 'AmazingHand', type: 'Robotická dlaň', cat: 'arm', level: 'Střední', hw: 'CC BY 4.0', sw: 'Apache-2.0',
    author: 'Pollen Robotics', render: true, alt: 'Robotická dlaň AmazingHand se čtyřmi prsty',
    short: 'Čtyřprstá dlaň s 8 stupni volnosti a pohony uvnitř.',
    lead: 'Čtyřprstá dlaň s 8 stupni volnosti a pohony uvnitř. Samostatně pro výzkum úchopu, nebo jako doplněk k ruce.',
    bomCost: 'pod 200 EUR', printTime: '—', software: 'Python / Arduino',
    repo: 'https://github.com/pollen-robotics/AmazingHand', docs: 'https://github.com/pollen-robotics/AmazingHand',
    card: [['Osy', '8 DOF'], ['Hmotnost', '≈ 400 g']],
    bom: [['Mikroservo Feetech', '8×'], ['Řídicí deska serv', '1×'], ['Zdroj', '1×'], ['Čepy a šrouby', '1 sada']],
    specs: [['Stupně volnosti', '8'], ['Prsty', '4 × 2 články'], ['Hmotnost', '≈ 400 g']],
    related: ['so101', 'lekiwi', 'thor'] },
  { id: 'otto', glb: true, name: 'Otto DIY', type: 'Výukový robot', cat: 'legged', level: 'Začátečník', hw: 'CC BY-SA 4.0', sw: 'GPL-3.0',
    author: 'Otto DIY', render: true, alt: 'Výukový robot Otto DIY',
    short: 'Malý chodící robot pro školy a kroužky — pod vedením dospělého.',
    lead: 'Malý chodící robot pro školy a kroužky — první setkání s Arduinem a programováním, pod vedením dospělého.',
    bomCost: '—', printTime: '—', software: 'Arduino, bloky',
    repo: 'https://www.ottodiy.com', docs: 'https://www.ottodiy.com',
    card: [['Serva', '4× SG90'], ['Řízení', 'Arduino Nano']],
    bom: [['Mikroservo SG90', '4×'], ['Arduino Nano a deska', '1×'], ['Ultrazvukový senzor', '1×'], ['Bzučák', '1×'], ['Držák baterií', '1×']],
    specs: [['Serva', '4× SG90'], ['Řízení', 'Arduino Nano'], ['Určeno', '14+, ve škole s dospělým']],
    related: ['spot', 'duck', 'so101'] },
  { id: 'spot', glb: true, name: 'SpotMicro', type: 'Čtyřnohý robot', cat: 'legged', level: 'Střední', hw: 'CC BY (Thingiverse)', sw: 'MIT',
    author: 'KDY0523 a komunita SpotMicroAI', render: true, alt: 'Čtyřnohý robot SpotMicro',
    short: 'Robotický pes na servech s Raspberry Pi.',
    lead: 'Robotický pes na servech s Raspberry Pi. Oblíbený projekt s velkou komunitou.',
    bomCost: '—', printTime: '—', software: 'ROS / Python',
    repo: 'https://www.thingiverse.com/thing:3445283', docs: 'https://spotmicroai.readthedocs.io/',
    card: [['Osy', '12 DOF'], ['Řízení', 'Raspberry Pi']],
    bom: [['Servo s vysokým momentem', '12×'], ['Raspberry Pi', '1×'], ['PWM deska PCA9685', '1×'], ['Baterie a měnič', '1×'], ['Ložiska a šrouby', '1 sada']],
    specs: [['Stupně volnosti', '12'], ['Řízení', 'Raspberry Pi']],
    related: ['duck', 'otto', 'lekiwi'] },
  { id: 'sawppy', glb: true, name: 'Sawppy', type: 'Rover', cat: 'mobile', level: 'Střední', hw: 'MIT', sw: 'MIT',
    author: 'Roger Cheng', render: true, alt: 'Šestikolový rover Sawppy',
    short: 'Šestikolový rover podle marsovských vozítek.',
    lead: 'Šestikolový rover podle marsovských vozítek Curiosity a Perseverance.',
    bomCost: 'pod 500 USD', printTime: '—', software: 'Python / Arduino',
    repo: 'https://github.com/Roger-random/Sawppy_Rover', docs: 'https://github.com/Roger-random/Sawppy_Rover',
    card: [['Kola', '6, rocker-bogie'], ['Pohon', 'LX-16A']],
    bom: [['Servo LewanSoul LX-16A', '10×'], ['Hliníkové profily 15 mm', '1 sada'], ['Ložiska a hřídele', '1 sada'], ['Řídicí deska a baterie', '1×']],
    specs: [['Kola', '6, rocker-bogie'], ['Pohon', 'serva LX-16A']],
    related: ['exomy', 'lekiwi', 'spot'] },
  { id: 'thor', glb: true, name: 'Thor', type: 'Robotická ruka', cat: 'arm', level: 'Pokročilý', hw: 'CC BY-SA 4.0', sw: 'CC BY-SA 4.0',
    author: 'Ángel L. M. (AngelLM)', render: true, alt: 'Robotická ruka Thor na krokových motorech',
    short: 'Průmyslová kinematika na krokových motorech, ROS 2. Výška 625 mm.',
    lead: 'Průmyslová kinematika na krokových motorech, řízení G-kódem, ROS 2 a MoveIt 2. Výška 625 mm, nosnost 750 g.',
    bomCost: 'pod 350 EUR', printTime: '≈ 113 h', software: 'GRBL, ROS 2',
    repo: 'https://github.com/AngelLM/Thor', docs: 'http://thor.angel-lm.com/documentation/',
    card: [['Osy', '6 DOF'], ['Nosnost', '750 g']],
    bom: [['Krokové motory NEMA a drivery', 'dle BOM'], ['Řídicí deska', '1×'], ['Řemeny a řemenice GT2', '1 sada'], ['Ložiska', '1 sada']],
    specs: [['Stupně volnosti', '6'], ['Výška', '625 mm'], ['Nosnost', '750 g'], ['Doba tisku', '≈ 113 h']],
    related: ['so101', 'hand', 'exomy'] },
  { id: 'exomy', glb: true, name: 'ExoMy', type: 'Rover', cat: 'mobile', level: 'Střední', hw: 'GPL-3.0', sw: 'GPL-3.0',
    author: 'ESA Planetary Robotics Lab', render: true, alt: 'Šestikolový rover ExoMy',
    short: 'Šestikolový rover podle mise ExoMars.',
    lead: 'Šestikolový rover podle mise ExoMars, ovládaný z prohlížeče nebo gamepadem.',
    bomCost: 'do 500 EUR', printTime: '—', software: 'ROS, webové rozhraní',
    repo: 'https://github.com/esa-prl/ExoMy', docs: 'https://github.com/esa-prl/ExoMy/wiki',
    card: [['Kola', '6, rocker-bogie'], ['Řízení', 'Raspberry Pi']],
    bom: [['Raspberry Pi', '1×'], ['PWM deska', '1×'], ['Servo pohonu', '6×'], ['Servo řízení', '6×'], ['Baterie a měnič', '1×']],
    specs: [['Kola', '6, rocker-bogie'], ['Řízení', 'Raspberry Pi']],
    related: ['sawppy', 'lekiwi', 'thor'] },
  { id: 'so102', mats: [['petcf', 'PET-CF + PETG', 'Dle projektu']], setups: true, credit: 'Vizualizace z modelu Robonine (CC BY 4.0)',  glb: true, name: 'SO-ARM 102', type: 'Robotická ruka', cat: 'arm', level: 'Střední', hw: 'CERN-OHL-P-2.0', sw: 'Apache-2.0',
    author: 'Robonine', render: true, alt: 'Robotická ruka SO-ARM 102 s paralelním chapadlem',
    short: 'Tužší a rychlejší nástupce SO-101. Paralelní chapadlo, díly z PET-CF a stejná kinematika pro LeRobot.',
    lead: 'Nástupce SO-101 od Robonine se stejným uspořádáním kloubů, takže funguje s datasety a politikami LeRobot. Proti SO-101 má paralelní chapadlo s rozevřením 85 mm a kamerou na zápěstí, topologicky optimalizované díly z PET-CF, silnější serva STS3250 v rameni a lokti a dvojnásobnou nosnost 300 g. Při stejné zátěži se špička prohne o polovinu méně, dosáhne dál (483 mm) a základna se otočí o 352°. Daní je vyšší cena (≈ 340 USD za pár místo ≈ 130 USD za ruku), 12V serva ve followeru a tisk z kompozitního filamentu.',
    bomCost: '≈ 340 USD za pár (≈ 374 USD s filamentem)', printTime: '≈ 52 h za pár', software: 'LeRobot (Python) + plugin SO-ARM 102',
    repo: 'https://github.com/roboninecom/SO-ARM-102', docs: 'https://lab.robonine.com',
    card: [['Nosnost', '300 g'], ['Dosah', '483 mm']],
    bom: [['Servo Feetech STS3215 (leader 5 V)', '6×'], ['Servo Feetech STS3215 12 V (zápěstí, chapadlo)', '2×'], ['Servo Feetech STS3235 12 V (základna, zápěstí)', '2×'], ['Servo Feetech STS3250 12 V (rameno, loket)', '2×'], ['Waveshare Bus Servo Adapter (follower)', '1×'], ['Waveshare Bus Servo Adapter (leader)', '1×'], ['Zdroj 12 V / 5 A (follower)', '1×'], ['Zdroj 5 V / 2 A (leader)', '1×'], ['USB kamera 1080p na zápěstí', '1×'], ['Ložisko 6812 do základny', '2×'], ['Vodicí tyč Ø6 × 125 mm (chapadlo)', '2×'], ['Truhlářská svěrka', '4×'], ['Šrouby a matice M2/M3', '1 sada'], ['Filament PET-CF + PETG', '≈ 1,15 kg']],
    specs: [['Stupně volnosti', '5 os + paralelní chapadlo'], ['Pohon followeru', '2× STS3250, 2× STS3235, 2× STS3215'], ['Napájení', 'follower 12 V, leader 5 V'], ['Dosah', '483 mm vodorovně'], ['Nosnost', '300 g (SO-101: 150 g)'], ['Průhyb při 300 g', '3,4–3,9 mm (SO-101: 7,5 mm)'], ['Rotace základny', '352° (SO-101: 220°)'], ['Chapadlo', 'paralelní, 0–85 mm, kamera'], ['Hluk v 1 m', '60 dB (SO-101: 70 dB)'], ['Tisk', 'PET-CF (ramena) + PETG/PETG-CF, vrstva 0,2 mm'], ['Doba tisku', '≈ 52 h za pár (3MF projekty)']],
    related: ['so101', 'aira', 'hand'] },
  { id: 'aira', mats: [['placf', 'PLA-CF + TPU', 'Dle projektu']], setups: true, credit: 'Vizualizace z modelu Nextis (Apache-2.0)',  glb: true, name: 'AIRA', type: 'Robotická ruka', cat: 'arm', level: 'Pokročilý', hw: 'Apache-2.0', sw: 'Apache-2.0',
    author: 'Nextis (Roberto De la Cruz González)', render: true, alt: 'Šestiosá tisknutelná robotická ruka AIRA s chapadlem a motory Damiao',
    short: 'Silná šestiosá ruka s chapadlem pro AI. Motory Damiao na sběrnici CAN, nativní plugin pro LeRobot.',
    lead: 'Tisknutelná ruka se šesti osami a chapadlem (7 DoF), postavená pro učení robotů. Follower pohání sedm motorů Damiao na sběrnici CAN — J8009P v základně a rameni, J4340P v lokti a zápěstí, J4310 v zápěstí a chapadle — s impedančním řízením MIT a špičkovým momentem až 35 Nm. Leader ruku se servy Dynamixel XL330 vedete rukou. Software je plugin pro LeRobot, takže teleoperace, nahrávání ukázek i trénink politik ACT, Diffusion Policy nebo PI0 fungují hned. Konstrukce se tiskne z PLA-CF, měkké prsty z TPU; na zápěstí lze připevnit kameru RealSense D405.',
    bomCost: '≈ 1 650 USD (follower), ≈ 1 850 USD (pár)', printTime: '—', software: 'LeRobot (Python), plugin lerobot-robot-aira',
    repo: 'https://github.com/robertorobotics/Nextis-AIRA-3D', docs: 'https://github.com/robertorobotics/Nextis-AIRA-3D/blob/main/hardware/ASSEMBLY.md',
    card: [['Osy', '6 DOF + chapadlo'], ['Software', 'LeRobot']],
    bom: [['Motor Damiao J8009P (9:1)', '2×'], ['Motor Damiao DM-J4340P (40:1)', '2×'], ['Motor Damiao DM-J4310 (10:1)', '3×'], ['Servo Dynamixel XL330-M077 (leader)', '7×'], ['USB-CAN adaptér (CANable / MKS CANable)', '1×'], ['Deska Bus Servo Adapter, USB-C → Dynamixel TTL (leader)', '1×'], ['Zdroj 24 V / 10 A+ (follower)', '1×'], ['Zdroj 5 V (leader)', '1×'], ['Zakončovací rezistor CAN 120 Ω', '2×'], ['Ložisko 6815 (leader)', '1×'], ['Šrouby M2–M5 (imbus)', '≈ 207 ks'], ['Kamera Intel RealSense D405 (volitelně)', '1×']],
    specs: [['Stupně volnosti', '6 os + chapadlo'], ['Pohon', 'Damiao J8009P, J4340P, J4310 (CAN)'], ['Moment', 'až 20 / 35 Nm (základna)'], ['Řízení', 'USB-CAN, impedanční řízení MIT'], ['Leader', '7× Dynamixel XL330-M077'], ['Napájení', '24 V (follower), 5 V (leader)'], ['Kamera', 'Intel RealSense D405 (volitelně)'], ['Tisk', 'PLA-CF (kalená tryska), prsty TPU; vrstva 0,2 mm'], ['Doba tisku', '—']],
    related: ['so101', 'so102', 'parol6'] },
  { id: 'parol6', mats: [['petg', 'PETG', 'Dle projektu']], credit: 'Vizualizace z modelu PAROL6 (GPL-3.0)',  glb: true, name: 'PAROL6', type: 'Průmyslová robotická ruka', cat: 'arm', level: 'Pokročilý', hw: 'GPL-3.0', sw: 'GPL-3.0',
    author: 'Petar Crnjak (Source Robotics)', render: true, alt: 'Šestiosá stolní robotická ruka PAROL6 s krokovými motory',
    short: 'Stolní šestiosá ruka navržená jako zmenšený průmyslový robot. Krokové motory s planetovými převodovkami, dosah 400 mm.',
    lead: 'Stolní šestiosá ruka, která konstrukcí, řídicím softwarem i ovládáním napodobuje průmyslové roboty. Šest krokových motorů NEMA 17 s přesnými planetovými převodovkami a řemenovými převody, řídicí deska s STM32F446 a drivery TMC5160, napájení 24 V. Dosah 400 mm, nosnost až 1 kg a opakovatelnost 0,08 mm. Ovládá se grafickým PAROL6 Commanderem se simulátorem, z Pythonu nebo přes ROS 2 a MoveIt. Díly se tisknou z PETG.',
    bomCost: '—', printTime: '—', software: 'PAROL6 Commander, Python API, ROS 2 / MoveIt',
    repo: 'https://github.com/PCrnjak/PAROL6-Desktop-robot-arm', docs: 'https://source-robotics.github.io/PAROL-docs/',
    card: [['Osy', '6 DOF'], ['Dosah', '400 mm']],
    bom: [['Krokový motor NEMA 17 (42×42×20 / 40 / 60 mm)', '1+3+2×'], ['Planetová převodovka NEMA 17 (2× 20:1, 1× 10:1)', '3×'], ['Řídicí deska PAROL6 (STM32F446)', '1×'], ['Driver TMC5160', '6×'], ['Zdroj 24 V / 5 A', '1×'], ['Kuželíková ložiska NSK HR32906J / HR32907J', '5+4×'], ['Axiální ložisko AXK3552', '1×'], ['Řemeny HTD 3M a řemenice', '4+3×'], ['Koncové spínače a indukční snímače', '3+3×'], ['Nouzové tlačítko (NC)', '1×'], ['Pneumatické chapadlo MHZ2-16D a ventil 5/2', '1+1×'], ['Šrouby a matice M2–M4', '1 sada']],
    specs: [['Stupně volnosti', '6'], ['Pohon', '6× NEMA 17, planetové převodovky a řemeny'], ['Řízení', 'STM32F446, drivery TMC5160'], ['Napájení', '24 V'], ['Dosah', '400 mm'], ['Nosnost', 'až 1 kg'], ['Opakovatelnost', '0,08 mm'], ['Hmotnost', '≈ 5,5 kg'], ['Tisk', 'PETG, vrstva 0,2 mm'], ['Doba tisku', '—']],
    related: ['thor', 'so101', 'aira'] },
  { id: 'bhl', credit: 'Vizualizace z modelu Hybrid Robotics (CC BY-SA 4.0)',  glb: true, name: 'Berkeley Humanoid Lite', type: 'Humanoid', cat: 'legged', level: 'Pokročilý', hw: 'CC BY-SA 4.0', sw: 'MIT',
    author: 'Hybrid Robotics, UC Berkeley', render: true, alt: 'Humanoidní robot Berkeley Humanoid Lite ve stoje',
    short: 'Humanoid v životní velikosti dítěte: 80 cm, 22 os a tištěné cykloidní převodovky.',
    lead: 'Výzkumný humanoid za méně než 5 000 USD. Převodovky pohonů i tělo se tisknou z PLA na běžné tiskárně, chůzi řídí RL politika přenesená ze simulace a ruce lze ovládat teleoperací přes VR.',
    bomCost: 'pod 5 000 USD (≈ 4 300 USD dle BOM)', printTime: '—', software: 'Isaac Lab, MuJoCo (Python)',
    repo: 'https://github.com/HybridRobotics/berkeley-humanoid-lite', docs: 'https://berkeley-humanoid-lite.gitbook.io/docs',
    card: [['Osy', '22 DOF'], ['Výška', '0,8 m']],
    bom: [['Pohon 6512 (BLDC + tištěná cykloidní převodovka)', '10×'], ['Pohon 5010 (BLDC + tištěná cykloidní převodovka)', '12×'], ['Driver motoru B-G431B-ESC1', '22×'], ['Mini PC Intel N95', '1×'], ['Adaptér USB-CAN', '4×'], ['IMU BNO085', '1×'], ['Baterie LiPo 6S 4000 mAh', '1×'], ['Chapadlo', '2×'], ['PLA filament, ložiska a šrouby', '1 sada']],
    specs: [['Stupně volnosti', '22 (nohy 2× 6, ruce 2× 5) + chapadla'], ['Výška', '0,8 m'], ['Hmotnost', '16 kg'], ['Pohony', '22× BLDC s tištěnou cykloidní převodovkou'], ['Řízení', 'Intel N95, sběrnice CAN'], ['Výdrž', '≈ 30 min (6S 4000 mAh)'], ['Tisk', 'PLA, stolní tiskárna'], ['Chůze', 'RL politika, sim2real']],
    related: ['duck', 'spot', 'so101'] },
  { id: 'osr', mats: [['pla', 'PLA+', 'Kryty a stožár'], ['petg', 'PETG', 'Odolnější teplu']], credit: 'Vizualizace z modelu JPL / Caltech (Apache-2.0)',  glb: true, name: 'Open Source Rover', type: 'Rover', cat: 'mobile', level: 'Pokročilý', hw: 'Apache-2.0', sw: 'Apache-2.0',
    author: 'JPL / Caltech', render: true, alt: 'Šestikolový hliníkový rover podle projektu NASA JPL Open Source Rover',
    short: 'Velký šestikolový rover z hliníkové stavebnice goBILDA, podle projektu NASA JPL Open Source Rover.',
    lead: 'Šestikolový marsovský rover podle projektu NASA JPL Open Source Rover: hliníková konstrukce, odpružení rocker-bogie a čtyři řízená kola. Raspberry Pi a ROS 2 z něj dělají robustní platformu pro výuku i výzkum v terénu. Na rozdíl od ostatních projektů je to hlavně montáž hardwaru — tisknou se jen krycí desky těla a hlava stožáru.',
    bomCost: '≈ 1 600 USD', printTime: '—', software: 'ROS 2 (Python), Raspberry Pi',
    repo: 'https://github.com/nasa-jpl/open-source-rover', docs: 'https://github.com/nasa-jpl/osr-rover-code',
    card: [['Kola', '6, rocker-bogie'], ['Motory', '10']],
    bom: [['Motor goBILDA 5203 Yellow Jacket s enkodérem', '6×'], ['Servo goBILDA 2000 (řízení kol)', '4×'], ['Kolo Wasteland 144 mm', '6×'], ['Řadič RoboClaw 2x7A', '3×'], ['Raspberry Pi 3/4/5', '1×'], ['PWM driver PCA9685', '1×'], ['Desky plošných spojů (brain + motor)', '2×'], ['Hliníkové profily a spojky goBILDA', '1 sada'], ['Krycí desky těla (laser, 3 mm)', '1 sada'], ['Baterie LiPo 4S', '1×']],
    specs: [['Kola', '6, rocker-bogie s diferenciálem'], ['Řízení', '4 natáčená kola (Ackermann)'], ['Pohon', '6× DC motor 223 ot/min + 4× servo'], ['Rychlost', 'až ≈ 1,6 m/s'], ['Řídicí jednotka', 'Raspberry Pi + 3× RoboClaw'], ['Napájení', 'LiPo 4S (14,8 V)'], ['Výdrž', '≥ 3 h (7,2 Ah)'], ['Konstrukce', 'hliník (goBILDA)'], ['Doba stavby', '≥ 100 h']],
    related: ['sawppy', 'exomy', 'lekiwi'] },
  { id: 'stackchan', credit: 'Vizualizace z modelu Stack-chan (Apache-2.0)',  glb: true, render: true, name: 'Stack-chan', type: 'Stolní robot-společník', cat: 'desk', level: 'Začátečník', hw: 'Apache-2.0', sw: 'Apache-2.0',
    author: 'Shinya Ishikawa (meganetaaan) a komunita', alt: 'Stolní robot Stack-chan s displejem místo obličeje na otočné hlavě',
    short: 'Malý stolní společník: displej s tváří, dvě serva a hlava, která se otáčí a kývá.',
    lead: 'Malý stolní společník, kterému obličej kreslí displej modulu M5Stack. Dvě serva otáčejí a naklánějí hlavu, chování se programuje v JavaScriptu nebo blocích přímo v prohlížeči.',
    bomCost: '—', printTime: '—', software: 'JavaScript (Moddable), bloky v prohlížeči',
    repo: 'https://github.com/stack-chan/stack-chan', docs: 'https://github.com/stack-chan/stack-chan/blob/develop/case/README.md',
    card: [['Osy', '2 (otáčení + náklon)'], ['Řízení', 'M5Stack (ESP32)']],
    bom: [['Modul M5Stack Core (Basic/Gray/Go/Fire)', '1×'], ['Mikroservo SG90 (nebo sériové RS30X / SCS0009)', '2×'], ['Deska Stack-chan pro serva', '1×'], ['Akumulátor Li-Pol 3,7 V s konektorem PH 2pin', '1×'], ['Šrouby M2 × 4 mm', '4×'], ['Šrouby M2 × 8 mm', '2×'], ['Šrouby M3 × 15 mm (volitelně)', '2×']],
    specs: [['Stupně volnosti', '2 (otáčení + náklon hlavy)'], ['Pohon', '2× SG90, RS30X nebo SCS0009'], ['Řízení', 'M5Stack Core / Core2 / CoreS3'], ['Tištěné díly', 'skořepina, nožky, držák serv, zadní kryt baterie'], ['Napájení', 'akumulátor 3,7 V nebo externích 5 V']],
    related: ['otto', 'so101', 'hand'] },
  { id: 'svrn', glb: true, glbShow: ['opt_modul_flipper'], render: true, sim: 'arena', credit: 'Vizualizace podle Project SVRN – Shoverobotics (CC BY 4.0), moduly printedrobotics.cz', name: 'Project SVRN', type: 'Bojový robot 150 g', cat: 'combat', level: 'Začátečník', hw: 'CC BY 4.0', sw: '—',
    author: 'Shoverobotics (Jordan Gell)', alt: 'Malý bojový robot Project SVRN s pohonem 4×4 a klínem',
    short: 'Modulární bojový robot do 150 g: tlačný robot (pusher) s pohonem 4×4, k tomu flipper nebo chapadlo.',
    lead: 'Modulární platforma pro soutěže antweight do 150 g, navržená pro nováčky. Základ je tlačný robot s pohonem všech čtyř kol, který lze osadit klínem, flipperem nebo chapadlem. Řídí ho Malenki Nano HV (verze pro čtyři motory N10) – přijímač a regulátory na jedné destičce – a ovládá se běžným vysílačem FlySky. Bez rotující zbraně, takže se hodí na první zápasy v České lize bojových robotů.',
    bomCost: '—', printTime: '—', software: 'bez programování (RC vysílač)',
    repo: 'https://www.printables.com/model/1272536-project-svrn-combat-robot-150g-uk-antweight-us-fai', docs: 'https://forum.bristolbotbuilders.com/t/project-svrn-modular-3d-printed-robot-files/472',
    card: [['Hmotnost', 'do 150 g'], ['Pohon', '4× N10']],
    bom: [['Převodový motor N10', '4×'], ['Malenki Nano HV (přijímač + regulátory)', '1×'], ['Akumulátor LiPo 2S', '1×'], ['Vypínač', '1×'], ['Kolo', '4×'], ['Servo KingMax C507 (modul flipper)', '1×'], ['Vysílač FlySky (AFHDS 2A), např. FS-i6X', '1×'], ['Šrouby a matice', 'dle návodu']],
    specs: [['Hmotnostní třída', '150 g (UK antweight, US fairyweight)'], ['Půdorys', 'v limitu CCRL 15 × 15 cm'], ['Pohon', '4× N10, 4×4'], ['Zbraň', 'klín, flipper nebo chapadlo (moduly)'], ['Varianty', '4 motory, nebo 2 motory s řemenem'], ['Řízení', 'Malenki Nano HV, FlySky AFHDS 2A'], ['Napájení', 'LiPo 2S'], ['Tisk', 'PLA, PC nebo PA12; boční pancíř a držáky z TPU'], ['Doba tisku', '—']],
    // Printables licence field was blank when fetched 2026-10-30 (data/components/svrn.json meta.project.licence)
    license: { hw: 'CC-BY-4.0', status: 'unverified', checked: '2026-10-30',
      sources: ['https://www.printables.com/model/1272536-project-svrn-combat-robot-150g-uk-antweight-us-fai'] },
    related: ['vert150', 'otto', 'exomy'] },

  { id: 'vert150', glb: true, render: true, sim: 'arena', credit: 'Vizualizace z modelu TheBlackfish, remix „150g vert“ od Muffin578 (CC BY-SA 4.0)', preparing: true, name: 'Vertikální spinner 150 g', type: 'Bojový robot 150 g', cat: 'combat', level: 'Střední', hw: 'CC BY-SA 4.0 nebo BY-NC-SA 4.0 (ověřujeme s autory)', sw: '—',
    author: 'TheBlackfish (remix „150g vert“ od Muffin578)', alt: 'Malý bojový robot s vertikálním rotujícím ostřím',
    short: 'Dvoukolový robot do 150 g s vertikálním rotujícím ostřím. Jen pro uzavřenou arénu.',
    lead: 'Dvoukolový bojový robot do 150 g s vertikálním spinnerem poháněným střídavým motorem BE1806. Pohon zajišťují dva převodové motory N20 přes Malenki Nano, zbraň vlastní regulátor ZTW Mantis Slim. Ostří se tiskne, tělo z PETG za zhruba dvě hodiny. Rotující zbraň je nebezpečná – zapínat jen v uzavřené aréně a s funkčním failsafe.',
    bomCost: '—', printTime: '≈ 2,1 h', software: 'bez programování (RC vysílač)',
    repo: 'https://www.printables.com/model/1146226-vertical-spinner-battlebot-antweight-150-g', docs: 'https://www.printables.com/model/1146226-vertical-spinner-battlebot-antweight-150-g',
    card: [['Hmotnost', 'do 150 g'], ['Zbraň', 'vertikální spinner']],
    bom: [['Převodový motor N20 (nebo N10)', '2×'], ['Malenki Nano (přijímač + regulátory)', '1×'], ['Střídavý motor BE1806 (zbraň)', '1×'], ['Regulátor ZTW Mantis Slim 15A (zbraň)', '1×'], ['Akumulátor LiPo 2S', '1×'], ['Vypínač', '1×'], ['Kolo Pololu', '2×'], ['Vysílač FlySky (AFHDS 2A), např. FS-i6X', '1×'], ['Filament PETG', '≈ 54 g']],
    specs: [['Hmotnostní třída', '150 g (UK antweight, US fairyweight)'], ['Půdorys', 'v limitu CCRL 15 × 15 cm'], ['Pohon', '2× N20, dvě kola'], ['Zbraň', 'vertikální spinner, BE1806'], ['Řízení', 'Malenki Nano + ZTW Mantis Slim 15A'], ['Napájení', 'LiPo 2S'], ['Tisk', 'PETG, tištěné ostří'], ['Doba tisku', '≈ 2,1 h (54 g)'], ['Bezpečnost', 'jen v uzavřené aréně, failsafe povinný']],
    // two candidate licences until the authors confirm: the derivation takes the stricter one (NC)
    license: { hw: ['CC-BY-SA-4.0', 'CC-BY-NC-SA-4.0'], status: 'unverified', checked: '2026-10-30',
      sources: ['https://www.printables.com/model/1146226-vertical-spinner-battlebot-antweight-150-g', 'https://www.thingiverse.com/thing:4835459'] },
    related: ['svrn', 'otto', 'sawppy'] },
  // ORCA v2 base hand, right; facts from orcahand_hardware (README, ASSEMBLY_ADDENDUM, CAD) and orca_core (config.yaml, docs)
  { id: 'orca', glb: true, bomSource: 'cad', bomDocs: 'orca_core', render: true, credit: 'Vizualizace z modelu ORCA Dexterity (CC BY 4.0)', name: 'ORCA Hand', type: 'Robotická dlaň', cat: 'arm', level: 'Pokročilý', hw: 'CC BY 4.0', sw: 'MIT',
    author: 'ORCA Dexterity', alt: 'Robotická dlaň ORCA Hand s pěti prsty na věži se servy',
    short: 'Pětiprstá dlaň se 17 stupni volnosti, poháněná šlachami ze serv ve věži pod zápěstím.',
    lead: 'Pětiprstá dlaň se 17 stupni volnosti: 16 kloubů v prstech a jeden v zápěstí. Prsty táhnou šlachy vedené v PTFE trubičkách od cívek na servech, která jsou ve věži pod zápěstím. Projekt podporuje serva Dynamixel i Feetech. Kůži prstů a dlaně odlijete ze silikonu do tištěných forem, nebo ji rychleji vytisknete z TPU. Varianta Touch má ve špičkách prstů hmatové senzory. Ovládá se z Pythonu knihovnou orca_core.',
    bomCost: '—', printTime: '—', software: 'orca_core (Python)',
    repo: 'https://github.com/orcahand/orcahand_hardware', docs: 'https://www.youtube.com/watch?v=TgIz7HiyaoU',
    card: [['Osy', '17 DOF'], ['Pohon', 'šlachy, 17 serv']],
    // compiled from the CAD assembly and orca_core docs (the project publishes no hand BOM): servo models orca_core/constants.py
    // MOTOR_MODELS; adapters docs/…/windows.md; PHB + 12 V setting-up-dynamixels.md; belt, rods, spool holders, fans, connector boards: CAD
    bom: [['Servo prstů: Dynamixel XC330 nebo Feetech HLS3915', '16×'], ['Servo zápěstí: Dynamixel XC430 nebo Feetech HLS3930', '1×'], ['Převodník USB: U2D2 (Dynamixel), nebo CH340 / CP210x (Feetech)', '1×'], ['Power Hub Board a adaptér 12 V (sestava s Dynamixel)', '1+1×'], ['Deska konektorů motorů (Gerber v repozitáři)', '12×'], ['Ventilátor chlazení věže', '2×'], ['Lanko na šlachy', '—'], ['PTFE trubička pro vedení šlach', '—'], ['Ozubený řemen zápěstí GT2 (v CAD GT2-142)', '1×'], ['Frézovaný držák cívek (výkres v 06_CNC)', '4×'], ['Závitová tyč (připojovací díl FrankaConnector)', '2×'], ['Ložiska 4×8×3 a 8×13×4 mm', '—'], ['Kolíky 2 mm a 3×50 mm, šrouby a matice', '1 sada'], ['Silikon na kůži (nebo filament TPU)', '—']],
    specs: [['Stupně volnosti', '17 (zápěstí + 16 v prstech)'], ['Klouby prstů', 'palec 4, ostatní prsty 3 (abdukce, MCP, PIP)'], ['Pohon', '17 serv Dynamixel nebo Feetech, šlachy v PTFE trubičkách'], ['Kůže', 'silikon odlitý do tištěných forem, nebo tisk z TPU'], ['Varianty', 'základní; Touch s hmatovými senzory ve špičkách prstů'], ['Simulace', 'URDF a MJCF (orcahand_description)'], ['Návod', 'video autorů a doplněk ASSEMBLY_ADDENDUM.md v repozitáři'], ['Tisk', 'projekty Bambu Studio s připravenými podložkami'], ['Doba tisku', '—']],
    license: { hw: 'CC-BY-4.0', sw: 'MIT', trademark: true, status: 'verified', checked: '2026-11-01',
      sources: ['https://github.com/orcahand/orcahand_hardware/blob/main/LICENSE', 'https://github.com/orcahand/orca_core/blob/main/LICENSE'] },
    related: ['hand', 'so101', 'aira'] },
  { id: 'sesame', glb: true, render: true, mats: [['pla', 'PLA / PLA+', 'Dle projektu']], credit: 'Vizualizace z modelu Sesame Robot Project (Apache-2.0)', name: 'Sesame', type: 'Čtyřnohý robot', cat: 'legged', level: 'Začátečník', hw: 'Apache-2.0', sw: 'Apache-2.0',
    author: 'Dorian Todd (Sesame Robot Project)', alt: 'Malý čtyřnohý robot Sesame s osmi mikroservy',
    short: 'Malý čtyřnohý robot s osmi mikroservy, ESP32 a displejem OLED, který slouží jako obličej.',
    lead: 'Malý tisknutelný čtyřnohý robot zaměřený na pohyb a výraz. Každou nohu pohánějí dvě mikroserva MG90S (180°), řídí ho ESP32 (Lolin S2 Mini nebo deska Sesame Distro Board) a displej OLED 128×64 kreslí obličej, který se mění podle pohybu. Ovládá se přes Wi-Fi z webového rozhraní nebo přes JSON API, případně sériovou konzolí po USB; animace se skládají v aplikaci Sesame Studio. Podle autora stačí základní pájení a znalost Arduino IDE.',
    bomCost: '50–60 USD (elektronika a spojovací materiál, dle autora)', printTime: '—', software: 'Arduino (C++), webové rozhraní, Sesame Studio',
    repo: 'https://github.com/dorianborian/sesame-robot', docs: 'https://github.com/dorianborian/sesame-robot/blob/main/docs/build-guide/README.md',
    card: [['Osy', '8 (2 na nohu)'], ['Řízení', 'ESP32']],
    bom: [['Mikroservo MG90S, 180°', '8×'], ['Displej OLED 0,96″ SSD1306 (I2C)', '1×'], ['Lolin S2 Mini (ESP32-S2) nebo deska Sesame Distro Board V3', '1×'], ['Kolébkový vypínač KCD1', '1×'], ['Akumulátor Bambu Lab 14500 (2S, 7,4 V, 800 mAh), volitelně', '1×'], ['Nabíječka Bambu Lab pro akumulátor 7,4 V (k akumulátoru)', '1×'], ['Měnič step-down 5 V / 3 A (S2 Mini s akumulátorem)', '1×'], ['Šroub M2 × 5 mm samořezný', '≈ 40×'], ['Šroub M2,5 × 5 mm (páky serv)', '10×'], ['Kabel USB-C (5 V / 3 A)', '1×'], ['Kabely, bužírky, stahovací pásky (viz BOM projektu)', '1 sada']],
    specs: [['Stupně volnosti', '8 (2 na každou nohu)'], ['Pohon', '8× MG90S 180°'], ['Řízení', 'ESP32 (Lolin S2 Mini nebo Sesame Distro Board)'], ['Displej', 'OLED 128×64'], ['Napájení', '5 V / 3 A (USB-C PD, nebo akumulátor s měničem)'], ['Ovládání', 'Wi-Fi, webové rozhraní, JSON API, sériová konzole'], ['Tisk', 'PLA, 11 dílů, výplň 8–10 %']],
    license: { hw: 'Apache-2.0', sw: 'Apache-2.0', status: 'verified', checked: '2026-11-01',
      sources: ['https://github.com/dorianborian/sesame-robot/blob/main/LICENSE'] },
    related: ['otto', 'spot', 'stackchan'] },
  { id: 'koch', glb: true, render: true, setups: true, credit: 'Vizualizace z modelu Koch v1.1 (Apache-2.0)', name: 'Koch v1.1', type: 'Robotická ruka', cat: 'arm', level: 'Začátečník', hw: 'Apache-2.0', sw: 'Apache-2.0',
    author: 'Jess Moss a Hugging Face (podle ruky Alexandera Kocha)', alt: 'Robotická ruka Koch v1.1 se servy Dynamixel a chapadlem',
    short: 'Ruka s pěti osami a chapadlem se servy Dynamixel pro teleoperaci a učení v LeRobot. Pár ovládací + výkonná ruka.',
    lead: 'Upravená verze levné ruky Alexandera Kocha; na rozdíl od originálu ji lze sestavit bez pájení. Výkonnou ruku (follower) pohánějí dvě serva Dynamixel XL430-W250-T a čtyři XL330-M288-T na 12 V, ovládací ruku (leader) šest XL330-M077-T na 5 V. Obě ruce se k počítači připojují přes desku Waveshare a USB-C a ovládají se knihovnou LeRobot. Projekt obsahuje modely ve formátech SolidWorks a STEP, schéma zapojení a video sestavení.',
    bomCost: '≈ 278 USD follower, ≈ 199 USD leader (ceny v USA dle README projektu, bez dopravy a DPH)', printTime: '—', software: 'LeRobot (Python)',
    repo: 'https://github.com/jess-moss/koch-v1-1', docs: 'https://github.com/jess-moss/koch-v1-1#assembly-instructions',
    card: [['Osy', '5 + chapadlo'], ['Pohon', 'Dynamixel']],
    bom: [['Servo Dynamixel XL430-W250-T (follower)', '2×'], ['Servo Dynamixel XL330-M288-T (follower)', '4×'], ['Servo Dynamixel XL330-M077-T (leader)', '6×'], ['Sada rámečků a volnoběžek FPX330-H101, 4 ks (follower)', '1×'], ['Sada rámečků a volnoběžek FPX330-H101, 4 ks (leader)', '1×'], ['Sada volnoběžek HN11-I101 (follower)', '1×'], ['Deska Waveshare Serial Bus Servo Driver (follower)', '1×'], ['Deska Waveshare Serial Bus Servo Driver (leader)', '1×'], ['Měnič napětí DC-DC (follower)', '1×'], ['Zdroj 12 V (follower)', '1×'], ['Zdroj 5 V (leader)', '1×'], ['Svěrka ke stolu (follower)', '1×'], ['Svěrka ke stolu (leader)', '1×'], ['Kabel USB-C (follower)', '1×'], ['Kabel USB-C (leader)', '1×'], ['Propojovací kabely (viz BOM projektu)', '1 sada']],
    specs: [['Stupně volnosti', '5 os + chapadlo'], ['Pohon followeru', '2× XL430-W250-T, 4× XL330-M288-T'], ['Pohon leaderu', '6× XL330-M077-T'], ['Napájení', 'follower 12 V, leader 5 V'], ['Sestavení', 'bez pájení, podle videa v projektu'], ['Tisk', 'PLA+, ABS nebo PETG; vrstva 0,2 mm, výplň ≈ 30 %']],
    license: { hw: 'Apache-2.0', sw: 'Apache-2.0', status: 'verified', checked: '2026-11-01',
      sources: ['https://github.com/jess-moss/koch-v1-1/blob/main/LICENSE', 'https://github.com/huggingface/lerobot/blob/main/LICENSE'] },
    related: ['so101', 'so102', 'aira'] },
  // Lab devices (cat 'lab'): no simulation. Model = the author's UC2 v2 STL files (TheBOX/SimpleBOX/BUILD_ME/STL) placed on the
  // 50 mm grid per APPLICATIONS/APP_SIMPLE-Smartphone_Microscope/mechanical/Readme.md; optics, magnets and screws not modelled.
  { id: 'uc2', glb: true, render: true, noElectronics: true, noSoftware: true, fastenersListed: true, credit: 'Vizualizace z dílů openUC2 (CERN-OHL-1.2): jednoduchý mikroskop pro telefon, mechanická verze. Sestavu jsme poskládali podle návodu a fotografií autorů; sestavený CAD model autoři nezveřejňují.', name: 'UC2', type: 'Modulární optická stavebnice', cat: 'lab', level: 'Začátečník', hw: 'CERN-OHL-1.2', sw: 'MIT',
    author: 'openUC2 (B. Diederich a kol.)', alt: 'Mikroskop pro chytrý telefon složený z tištěných kostek UC2 na základní desce',
    short: 'Optické pokusy z tištěných kostek o hraně 50 mm. Model ukazuje jednoduchý mikroskop pro chytrý telefon.',
    lead: 'Otevřený modulární systém pro optiku a mikroskopii: tištěné kostky o hraně 50 mm drží pohromadě kuličkové magnety v základní desce a do kostek se zasouvají vložky se zrcadly, čočkami nebo držákem vzorku. Model ukazuje mechanickou verzi jednoduchého mikroskopu pro chytrý telefon podle návodu autorů: objektiv v zaostřovací kostce (Z-stage), dvě zrcadla pod 45°, okulár s držákem telefonu a držák vzorku nad objektivem. Tato sestava nemá elektroniku ani software.',
    bomCost: '≈ 65 EUR (odhad autorů pro tuto sestavu)', printTime: '—', software: 'Pro tuto sestavu žádný (mechanická verze)',
    repo: 'https://github.com/openUC2/UC2-GIT', docs: 'https://github.com/openUC2/UC2-GIT/tree/master/APPLICATIONS/APP_SIMPLE-Smartphone_Microscope/mechanical',
    card: [['Kostka', '50 mm'], ['Sestava', 'mikroskop pro telefon']],
    bom: [['Objektiv mikroskopu (např. 10×, NA 0,25)', '1×'], ['Okulár (např. 20×)', '1×'], ['Zrcátko (např. 30 × 30 mm)', '2×'], ['Kuličkový magnet 5 mm', '32–36×'], ['Šroub M3 × 12 (DIN 912)', '32–56×'], ['Šroub M3 × 8 (DIN 912, pozinkovaný)', '7×'], ['Šroub M3 × 30 a matice M3, nemagnetické', '1×'], ['Chytrý telefon', '1×']],
    specs: [['Kostka', '50 mm, tištěná nebo vstřikovaná'], ['Spojení', 'kuličkové magnety 5 mm v základní desce'], ['Moduly sestavy', 'Z-stage, 2× zrcadlo 45°, okulár s držákem telefonu, držák vzorku, 2 prázdné kostky'], ['Zaostření', 'hrubé ≈ 30 mm posunem objektivu, jemné ≈ ±6 mm ozubeným kolem'], ['Optika', 'objektiv (160 mm od zrcadla) + okulár'], ['Elektronika', 'žádná (mechanická verze)']],
    license: { hw: 'CERN-OHL-1.2', sw: 'MIT', status: 'verified', checked: '2026-11-01',
      sources: ['https://github.com/openUC2/UC2-GIT/blob/afc9de36f27d5a387e6b9ef1d85ae0cf33b4d3d6/License.md'] },
    related: ['stackchan', 'otto', 'so101'] },
  // Lab devices (cat 'lab'), no simulation. Models = the authors' per-part STEP files, which they exported in the
  // assembly's coordinates (Sidekick: 3D_Assets, commit f799c0f; Poseidon: HARDWARE/pump/step, commit 5a139fe).
  // Bought parts (motors, pumps, rods, syringe, electronics) are not modelled.
  { id: 'sidekick', liquids: true, mats: [['petg', 'PETG (nebo PLA)', 'Dle projektu']], glb: true, render: true, credit: 'Vizualizace z dílů Sidekick (CERN-OHL-S-2.0); nožičky a držák zkumavek vynechány, motory, pumpy a elektronika nejsou modelované', name: 'Sidekick', type: 'Dávkovací robot na kapaliny', cat: 'lab', level: 'Střední', hw: 'CERN-OHL-S-2.0', sw: 'CERN-OHL-S-2.0',
    author: 'Rodolfo Keesey a kol.', alt: 'Stolní dávkovací robot Sidekick s ramenem nad držákem mikrotitrační destičky',
    short: 'Stolní robot, který dávkuje kapaliny do 96jamkové destičky. Kloubové rameno nad destičkou, čtyři pumpy po 10 µl.',
    lead: 'Stolní robot pro dávkování kapalin do standardních mikrotitračních destiček (SBS, 96 jamek). Dva ploché krokové motory NEMA 17 natáčejí kloubové rameno nad destičkou, na jeho konci ústí hadičky ze čtyř elektromagnetických pump The Lee Company, které dávkují po 10 µl. Řídí ho Raspberry Pi Pico s programem v MicroPythonu a ovládá se jednoduchými příkazy přes USB. Kostra je celá tištěná, autoři doporučují PETG. Nejdražší částí jsou pumpy (4 × 135 USD podle kusovníku z roku 2022). Autoři dali pod licenci hardwaru (CERN-OHL-S-2.0) i program pro Pico.',
    bomCost: '≈ 710 USD (4 pumpy, přepočtená cena autorů 2/2022; při nákupu celých balení ≈ 830 USD)', printTime: '—', software: 'MicroPython (Raspberry Pi Pico), příkazy přes USB',
    repo: 'https://github.com/rodolfokeesey/Liquid-Handler', docs: 'https://github.com/rodolfokeesey/Liquid-Handler/blob/main/Supporting_Documentation/assembly_guide.pdf',
    card: [['Pumpy', '4 × 10 µl'], ['Destička', '96 jamek (SBS)']],
    bom: [['Pumpa The Lee Company LPMA1250110L (10 µl)', '4×'], ['Plochý krokový motor NEMA 17, 0,9°', '2×'], ['Driver krokového motoru TMC2209', '2×'], ['Raspberry Pi Pico', '1×'], ['Darlingtonovo pole ULN2803A', '1×'], ['Deska plošných spojů Sidekick (výroba podle souborů projektu)', '1×'], ['Ložisko 623-2Z (3 × 10 × 4 mm)', '3×'], ['Koncový spínač', '2×'], ['Tlačítko', '1×'], ['Zdroj 12 V', '1×'], ['PTFE hadičky 1/16″ a 1/8″', '1 sada'], ['Šrouby M2–M4', '1 sada'], ['Filament PETG', '1 kg']],
    specs: [['Dávkování', '4 pumpy, po 10 µl'], ['Pohyb', 'kloubové rameno, 2× NEMA 17 (0,9°)'], ['Řízení', 'Raspberry Pi Pico, MicroPython, drivery TMC2209'], ['Napájení', 'zdroj 12 V'], ['Destička', 'SBS, 96 jamek'], ['Tisk', 'PETG (nebo PLA), výplň 20 %, s podporami'], ['Doba tisku', '—']],
    license: { hw: 'CERN-OHL-S-2.0', sw: 'CERN-OHL-S-2.0', status: 'verified', checked: '2026-11-01',
      sources: ['https://github.com/rodolfokeesey/Liquid-Handler/blob/main/license.txt'] },
    related: ['poseidon', 'so101', 'parol6'] },
  { id: 'poseidon', liquids: true, syringe: true, mats: [['pla', 'PLA', 'Dle projektu']], glb: true, render: true, credit: 'Vizualizace z dílů poseidon (BSD-2-Clause): jedna pumpa; kryt a držák stříkačky vynechány, motor, tyče a stříkačka nejsou modelované', name: 'Poseidon', type: 'Stříkačková (injekční) pumpa', cat: 'lab', level: 'Střední', hw: 'BSD-2-Clause', sw: 'BSD-2-Clause',
    author: 'Pachter Lab, Caltech – A. Sina Booeshaghi a kol.', alt: 'Tištěné tělo stříkačkové pumpy Poseidon s posuvnými saněmi',
    short: 'Stříkačková pumpa pro mikrofluidiku: krokový motor posouvá saně se stříkačkou. Jedna řídicí deska ovládá až tři pumpy.',
    lead: 'Otevřená stříkačková (injekční) pumpa z laboratoře Pachter Lab na Caltechu, určené hlavně pro mikrofluidiku. Krokový motor NEMA 17 otáčí závitovou tyčí M5, která posouvá saně na dvou ocelových vodicích tyčích s lineárními ložisky; saně tlačí na píst stříkačky. Arduino s CNC shieldem řídí až tři pumpy, ovládají se z grafického programu v Pythonu na počítači nebo na Raspberry Pi. K systému patří i mikroskop (není v modelu). Tištěné díly jsou z PLA.',
    bomCost: '≈ 175 USD za 3 pumpy (kusovník autorů, ceny z 1/2019); celý systém s mikroskopem pod 400 USD', printTime: '—', software: 'Python (PyQt5) + firmware pro Arduino',
    repo: 'https://github.com/pachterlab/poseidon', docs: 'https://pachterlab.github.io/poseidon/hardware',
    card: [['Pohon', 'NEMA 17 + závit M5'], ['Řízení', 'Arduino + CNC shield']],
    bom: [['Krokový motor NEMA 17 (40 mm, 45 Ncm)', '1× na pumpu'], ['Spojka hřídele 5 mm / 5 mm', '1× na pumpu'], ['Ocelová tyč 6 mm, délka 200 mm', '2× na pumpu'], ['Lineární ložisko 6 mm', '2× na pumpu'], ['Závitová tyč M5 × 0,8, délka 170 mm, a matice M5', '1× na pumpu'], ['Šrouby M3 × 20 a M3 × 10, matice M3', '4 + 2 + 2× na pumpu'], ['Knoflík M5 (drží stříkačku)', '1× na pumpu'], ['Arduino + CNC shield (pro až 3 pumpy)', '1×'], ['Zdroj 12 V', '1×'], ['Injekční stříkačka', '1× na pumpu']],
    specs: [['Pohon', 'NEMA 17, závitová tyč M5 × 0,8'], ['Vedení', '2× ocelová tyč 6 mm, lineární ložiska'], ['Řízení', 'Arduino + CNC shield (DRV8825), mikrokrokování 1/32'], ['Pump na desku', 'až 3'], ['Napájení', 'zdroj 12 V'], ['Tlak', 'podle autorů až 4 MPa s 1ml stříkačkou'], ['Tisk', 'PLA'], ['Doba tisku', '—']],
    license: { hw: 'BSD-2-Clause', sw: 'BSD-2-Clause', status: 'verified', checked: '2026-11-01',
      sources: ['https://github.com/pachterlab/poseidon/blob/master/LICENSE'] },
    related: ['sidekick', 'parol6', 'so101'] },

  // RC cars (checked 2026-11-01 from the repos; models: tools/robots-cad/rc128.py, zcar2.py, step2glb.py)
  { id: 'rc128', glb: true, render: true, rcControl: true, credit: 'Vizualizace z FreeCAD souborů open-128-rc-car – Kurtis Kopf (CC BY 4.0), kola umístěna námi', name: 'Open 1:28 RC Car', type: 'RC auto 1:28', cat: 'mobile', level: 'Střední', hw: 'CC BY 4.0', sw: 'MIT',
    author: 'Kurtis Kopf (zortness)', alt: 'Malé tištěné RC auto v měřítku 1:28 s motorem 130 vzadu a servem řízení vpředu',
    short: 'Levné tištěné RC autíčko 1:28 pro školní týmy: plochý podvozek, motor 130 a mikroservo, ovládání běžným RC vysílačem.',
    lead: 'Malé auto v měřítku 1:28, které navrhl trenér středoškolského týmu, aby si škola mohla postavit víc aut za málo peněz. Podvozek je jedna tištěná deska, řízení obstarává mikroservo, zadní nápravu pohání kartáčový motor 130 přes ozubená kola 10/42 zuby. Napájí ho 2S akumulátor (6–8 V) – LiPo, Li-ion nebo bezpečnější LiFePO4 velikosti AA. Ovládá se běžným RC vysílačem, nic se neprogramuje. Návod popisuje i rychlejší varianty, které se podle autora vyrovnají sériovým autům 1:28. LiPo akumulátor vyžaduje opatrnost – viz Bezpečnost.',
    bomCost: '≈ 70 USD na auto (odhad autora při stavbě více aut; rychlejší auto do 100 USD)', printTime: '—', software: 'bez programování (RC vysílač)',
    repo: 'https://github.com/zortness/open_128_rc_car', docs: 'https://github.com/zortness/open_128_rc_car/blob/main/doc/gettingstarted.md',
    card: [['Měřítko', '1:28'], ['Pohon', 'motor 130']],
    bom: [['Kartáčový motor velikosti 130', '1×'], ['Regulátor pro kartáčový motor (ESC)', '1×'], ['Mikroservo', '1×'], ['RC vysílač a přijímač (2 kanály)', '1 sada'], ['Akumulátor 2S (LiPo/Li-ion) nebo 2× LiFePO4 14500 s držákem', '1×'], ['Nabíječka k akumulátoru', '1×'], ['Ložisko MR63ZZ', '6×'], ['Závitová tyč M3, 70–75 mm (zadní náprava)', '1×'], ['Šrouby a matice M2 a M3', 'dle návodu'], ['Pneumatiky: 2 úzké přední, 2 široké zadní', '4×']],
    specs: [['Měřítko', '1:28'], ['Pohon', 'kartáčový motor 130, převod 10/42 zubů; varianty s bezkartáčovým 1410'], ['Řízení', 'mikroservo'], ['Napájení', '2S, 6–8 V (LiPo, Li-ion nebo LiFePO4)'], ['Tisk', 'PLA (PETG odolnější), tryska 0,4 mm'], ['CAD', 'FreeCAD 1.1'], ['Bezpečnost', 'LiPo nabíjet jen balančním nabíječem, v ohnivzdorném vaku a pod dohledem; nafouklý či poškozený akumulátor vyřadit; dlouhodobě skladovat napůl nabitý; zkrat vodičů může způsobit požár. Děti jen s dospělým.']],
    license: { hw: 'CC-BY-4.0', sw: 'MIT', status: 'verified', checked: '2026-11-01',
      notes: 'FreeCAD soubory, obrázky a dokumentace: CC BY 4.0; zdrojový kód (Python nástroje): MIT.',
      sources: ['https://github.com/zortness/open_128_rc_car/blob/main/LICENSE.md', 'https://github.com/zortness/open_128_rc_car/blob/main/doc/history.md'] },
    related: ['zcar2', 'lizard', 'exomy'] },
  { id: 'zcar2', glb: true, render: true, rcControl: true, noGuide: true, credit: 'Vizualizace ze sestavy zcar2 – Alex Yu (GPL-3.0)', name: 'zcar2', type: 'RC drift auto 1:28', cat: 'mobile', level: 'Střední', hw: 'GPL-3.0', sw: '—',
    author: 'Alex Yu (alexyu132)', alt: 'Tištěný podvozek driftového RC auta 1:28 s pohonem všech kol',
    short: 'Skoro celé tištěné driftové auto 1:28 s pohonem 4×4, tištěnými kardany a pneumatikami z TPU. Vejde se pod většinu karoserií MINI-Z (rozvor M).',
    lead: 'Driftové auto v měřítku 1:28 s rozvorem 90 mm, pod které se vejde karoserie MINI-Z (autor ověřil AE86). Má nezávislé posuvné odpružení, pohon všech čtyř kol tištěnými kardany bez diferenciálů, motor 130 a baterii uprostřed a tištěné pneumatiky z TPU. Pozor: některé díly jsou podle autora náročné na tisk a návod na sestavení zatím chybí – repozitář má jen seznam dílů a videa. Poslední změna je z roku 2020. Napájí ho malý LiPo 2S – viz Bezpečnost.',
    bomCost: '—', printTime: '—', software: 'bez programování (RC vysílač)',
    repo: 'https://github.com/alexyu132/zcar2', docs: 'https://github.com/alexyu132/zcar2#readme',
    card: [['Měřítko', '1:28'], ['Pohon', '4×4']],
    bom: [['Kartáčový motor 130 (pro 2S)', '1×'], ['Servo GH-S37D 3,7 g', '1×'], ['Regulátor pro kartáčový motor (2S)', '1×'], ['Přijímač, alespoň 2 kanály (např. FlySky GR3E bez krabičky)', '1×'], ['Akumulátor LiPo 2S 300 mAh (Venom Fly)', '1×'], ['Ložisko MR105', '8×'], ['Tlačná pružinka ≈ 4 mm', '4×'], ['Šrouby M3 s půlkulatou hlavou (8–18 mm)', '17×'], ['Pojistná matice M3', '17×'], ['Karoserie MINI-Z, rozvor M', '1×']],
    specs: [['Měřítko', '1:28, rozvor 90 mm (MINI-Z M)'], ['Pohon', '4×4, tištěné kardany, bez diferenciálů'], ['Odpružení', 'nezávislé, posuvné'], ['Řízení', 'servo 3,7 g, paralelní geometrie pro drift'], ['Napájení', 'LiPo 2S 300 mAh'], ['Pneumatiky', 'tištěné z TPU'], ['Návod', 'zatím není (README: „Todo“)'], ['Bezpečnost', 'LiPo nabíjet jen balančním nabíječem, v ohnivzdorném vaku a pod dohledem; nafouklý či poškozený akumulátor vyřadit; dlouhodobě skladovat napůl nabitý; zkrat vodičů může způsobit požár. Děti jen s dospělým.']],
    license: { hw: 'GPL-3.0', status: 'verified', checked: '2026-11-01',
      notes: 'Celý repozitář (STL, SketchUp model) je pod GPL-3.0; náš 3D model z něj je proto také GPL-3.0.',
      sources: ['https://github.com/alexyu132/zcar2/blob/master/LICENSE'] },
    related: ['rc128', 'lizard', 'exomy'] },
  { id: 'lizard', glb: true, render: true, swNotFree: true, credit: 'Vizualizace ze sestavy Lizard – TRD-B (CC BY 4.0), bez šroubů a ložisek', name: 'Lizard', type: 'RC závodní auto', cat: 'mobile', level: 'Pokročilý', hw: 'CC BY 4.0', sw: 'CC BY 4.0',
    author: 'TRD-B', alt: 'Velké tištěné závodní RC auto Lizard s přítlačným křídlem a terénními koly',
    short: 'Velké tištěné silniční závodní auto s vlastní elektronikou: ESP32 v autě i ve vysílači, telemetrie a záznam dat. Není to levná hračka.',
    lead: 'Silniční závodní auto, ke kterému autor zveřejnil všechno: tisková data STL i STEP, celou sestavu, desky plošných spojů pro auto i vlastní vysílač, kód pro ESP32 a záznamník dat s vyhodnocením v MATLABu. Pohání ho kartáčový motor 775 (150 W) přes převodovku a diferenciál, kola jsou kupovaná Carson 1:8. Autorův kusovník dává dohromady ≈ 954 EUR – počítá s celými baleními dílů (šrouby po 100 kusech) a s akumulátorem LiPo 3S 5000 mAh. Je to projekt pro pokročilé, s pájením a výrobou desek, ne levná hračka. Velký akumulátor a silný motor vyžadují opatrnost – viz Bezpečnost.',
    bomCost: '≈ 954 EUR (součet kusovníku autora „BOM Lizard.xlsx“, německé ceny, celá balení dílů)', printTime: '—', software: 'Arduino (ESP32) v autě i vysílači; MATLAB pro záznam dat',
    repo: 'https://github.com/TRD-B/Lizard', docs: 'https://www.instructables.com/Lizard-3D-Printed-RC-Race-Car/',
    card: [['Motor', '775, 150 W'], ['Elektronika', 'ESP32']],
    bom: [['Motor 775, 12 V, 150 W', '1×'], ['Chladič motoru 40–45 mm', '1×'], ['Řadič motoru Cytron MD20A', '1×'], ['Servo Graupner DES 708 BB MG + servo saver Tamiya', '1×'], ['Kola Carson 1:8 buggy', '2 sady'], ['Akumulátor LiPo 3S 5000 mAh (auto)', '1×'], ['Akumulátory NiMH AA (vysílač)', '6×'], ['ESP32 s externí anténou', '2×'], ['Desky plošných spojů auta a vysílače (Gerber v repozitáři)', '2×'], ['Ventilátor 50 mm, 12 V', '2×'], ['Ložiska (683ZZ, 6802ZZ, 6804ZZ, 608ZZ, 605ZZ, MR85ZZ, kluzná)', 'dle kusovníku'], ['Šrouby M3, matice, závitové vložky', 'dle kusovníku'], ['Filament PETG + TPU', '≈ 3 kg + 0,75 kg']],
    specs: [['Rozměry (sestava autora)', '≈ 466 × 312 × 152 mm (s křídlem)'], ['Pohon', 'kartáčový motor 775, převodovka, diferenciál, kardany'], ['Řízení', 'servo, vlastní deska s ESP32'], ['Vysílač', 'vlastní, ESP32, 6× AA'], ['Napájení', 'LiPo 3S 5000 mAh (11,1 V)'], ['Data', 'telemetrie, záznamník dat, MATLAB'], ['Tisk', 'PETG, díly z TPU'], ['Bezpečnost', 'Velký LiPo 3S: nabíjet jen balančním nabíječem, v ohnivzdorném vaku a pod dohledem; nafouklý či poškozený akumulátor vyřadit; dlouhodobě skladovat napůl nabitý; zkrat může způsobit požár. Pojistka 30 A je v kusovníku. Těžké auto se silným motorem – jezdit jen na uzavřené ploše bez lidí. Děti jen s dospělým.']],
    license: { hw: 'CC-BY-4.0', sw: 'CC-BY-4.0', status: 'verified', checked: '2026-11-01',
      notes: 'Repozitář (STL, STEP, desky, kód) je pod CC BY 4.0 (License.md). Sestava obsahuje i modely kupovaných dílů (kola, motor, servo).',
      sources: ['https://github.com/TRD-B/Lizard/blob/main/License.md', 'https://github.com/TRD-B/Lizard/blob/main/BOM%20Lizard.xlsx'] },
    related: ['rc128', 'zcar2', 'exomy'] }
];
// Browser demos linked from product pages (r.sim). colorParam: the sim reads ?color= (so101 does not yet).
// Sizes = uncompressed bytes of a first visit (all responses until the sim is idle, Chromium, empty cache);
// so101 measured 8 400 906 B after the MuJoCo wasm strip (tools/wasm). The loader shows the engine part only (5,3 MB).
// re-measure when sim/** changes.
window.PR_SIMS = {
  arena: { path: 'sim/arena/', robotParam: true, colorParam: true, label: 'Vyzkoušejte v aréně', note: 'Hra v prohlížeči · zdarma · ≈\u00A03,5\u00A0MB' },
  so101: { path: 'sim/so101/', label: 'Vyzkoušejte v simulaci', note: 'Simulace v prohlížeči · zdarma · ≈\u00A08,4\u00A0MB' }
};
// Robot without its own software (RC-controlled); same test in app.js and tools/build.mjs.
window.PR_NO_SW = function (r) { return !r.sw || String(r.sw).trim() === '—'; };
// Per-robot FAQ flags: r.rcControl = driven with an RC transmitter, nothing to program (even if the repo has code);
// r.swNotFree = part of the software is not free (e.g. MATLAB); r.noGuide = the project has no assembly guide.
// Safety notes built from what a robot actually contains (used by app.js and tools/build.mjs).
window.PR_SAFETY = function (r) {
  var all = JSON.stringify([r.bom || [], r.specs || [], r.lead || '']);
  var w = ['Určeno osobám od 14 let; mladší pouze pod dohledem dospělého. Pohyblivé části mohou přiskřípnout prsty.'];
  if (/LiPo|Li-Pol|Li-ion|akumulátor|baterie/i.test(all)) w.push('Lithiové akumulátory nabíjejte jen vhodnou nabíječkou, pod dohledem a mimo hořlavé předměty; poškozený článek nepoužívejte.');
  if (/\b(24|22,2|14,8) ?V\b|\d+ ?Nm/.test(all)) w.push('Silné motory: pohybující se rameno může způsobit zranění. Při oživování držte ruce mimo dosah a mějte po ruce vypínač napájení.');
  if (/pneumatick|stlačen/i.test(all)) w.push('Pneumatické chapadlo pracuje se stlačeným vzduchem – používejte jen schválený zdroj a hadice.');
  if (/230 ?V|síťov/i.test(all)) w.push('Zdroj připojený k síti 230 V smí zapojovat jen osoba s odpovídající kvalifikací.');
  if (/(^|[^a-zá-ž])magnet(?!ick)/i.test(all)) w.push('Obsahuje malé silné magnety: spolknutí více kusů může vážně poškodit střeva. Uchovávejte mimo dosah malých dětí. Při spolknutí ihned vyhledejte lékaře.');
  if (r.cat === 'combat') {
    w.push('Bojového robota zapínejte jen v uzavřené aréně nebo s odpojenou zbraní. Nejdřív zapněte vysílač, potom robota; vypínejte v opačném pořadí a před prvním zápasem ověřte failsafe (po vypnutí vysílače se robot musí zastavit).');
    if (/spinner|rotuj/i.test(all)) w.push('Rotující zbraň může vážně zranit a vymrštit úlomky: mimo arénu ji vždy zajistěte a nikdy ji neroztáčejte v ruce ani na stole.');
    if (/flipper/i.test(all)) w.push('Flipper se pohybuje prudce: při manipulaci s robotem mějte prsty mimo jeho dráhu.');
  }
  // devices that handle liquids (r.liquids) / syringe pumps that build up pressure (r.syringe; poseidon README, Safety Considerations)
  if (r.liquids) w.push('Laboratorní přístroj: kapaliny držte dál od elektroniky a zdroje, chemikálie a biologický materiál používejte jen podle pravidel laboratoře a pod dohledem. Tištěné díly z PLA nebo PETG nemusí odolat organickým rozpouštědlům. Přístroj nejdřív vyzkoušejte nasucho, bez kapalin.');
  if (r.syringe) w.push('Stříkačková pumpa vyvine velký tlak: při ucpané hadičce může stříkačka nebo spoj prasknout a vystříknout kapalinu. Proud driveru motoru nastavte podle návodu autorů a pracujte s ochrannými brýlemi.');
  if (!r.noElectronics) w.push('Hardware napájejte jen zdrojem uvedeným v návodu projektu.');
  return w;
};
// Parameters shown on the product page and in JSON-LD; unknown values ('—' or empty) are left out.
// "Co budete potřebovat": what you buy or print yourself, per the project's bill of materials (app.js and tools/build.mjs).
// We sell nothing: tier 'parts' = printed parts only, 'kit' = everything; pair: leader + follower (robots with r.setups). Items: [name, qty, kind].
window.PR_BOX = function (r, tier, pair) {
  var items = [['Tištěné díly podle STL projektu' + (r.setups ? (pair ? ' — leader i follower' : ' — follower') : ''), pair ? '2 sady' : '1 sada', 'Tisk']];
  if (tier !== 'parts') {
    if (r.id === 'so101') {
      // SO-ARM100 README, bill of materials for SO-101 (pair = follower + leader)
      items.push(['Servo Feetech STS3215 7,4 V, převod 1/345', pair ? '7×' : '6×', 'Hardware']);
      if (pair) { items.push(['Servo Feetech STS3215 7,4 V, převod 1/191', '2×', 'Hardware']); items.push(['Servo Feetech STS3215 7,4 V, převod 1/147', '3×', 'Hardware']); }
      items.push(['Řídicí deska serv', pair ? '2×' : '1×', 'Hardware'], ['Zdroj 5 V', pair ? '2×' : '1×', 'Hardware'], ['Kabel USB-C', '2×', 'Hardware'], ['Svěrky ke stolu', pair ? '4×' : '2×', 'Hardware']);
    } else { (r.bom || []).forEach(function (b) { if (r.setups && !pair && /leader/i.test(b[0]) && !/follower/i.test(b[0])) return; items.push([b[0], b[1], 'Hardware']); }); }
    if (!r.fastenersListed) items.push(['Spojovací materiál podle návodu projektu', '—', 'Hardware']);
  }
  return items;
};
// r.bomSource: where the parts list comes from. Default: the project's published BOM; 'cad': the project publishes
// no BOM and we compiled the list from its CAD assembly and docs (box title, note, FAQ and meta description say so).
window.PR_BOM_CAD = function (r) { return r.bomSource === 'cad'; };
window.PR_BOX_TITLE = function (r, n) { return (window.PR_BOM_CAD(r) ? 'Sestaveno z CAD a dokumentace projektu · ' : 'Podle kusovníku projektu · ') + n + ' položek'; };
window.PR_BOX_NOTE = function (r) { if (window.PR_BOM_CAD(r)) return 'Projekt kusovník nezveřejňuje; seznam jsme sestavili z CAD sestavy a dokumentace projektu' + (r.bomDocs ? ' (' + r.bomDocs + ')' : '') + '. Počty ověřte v CAD.'; return r.id === 'so101' ? 'Počty dle kusovníku projektu SO-ARM100 (follower 7,4 V, zdroj 5 V). Follower s 12V servy: 6× C018 a zdroj 12 V / 5 A.' : 'Položky dle kusovníku projektu; přesné počty a varianty ověřte v jeho dokumentaci.'; };
// FAQ of a kit page (app.js renders it, tools/build.mjs pre-renders it and adds it as FAQPage structured data).
window.PR_FAQ = function (r) {
  var cad = window.PR_BOM_CAD(r);
  return [
    ['Zvládnu sestavení bez zkušeností?', 'Náročnost tohoto projektu: ' + r.level + (r.noGuide ? '. Projekt návod na sestavení nemá; repozitář obsahuje seznam dílů a videa.' : '. Návod projektu vede krok za krokem; odkaz najdete v sekci Licence a bezpečnost.')],
    [r.cat === 'lab' ? 'Můžu si sadu koupit u vás?' : 'Můžu si robota koupit u vás?', (cad ? 'Ne, nic neprodáváme. Díly koupíte přímo u dodavatelů; projekt kusovník nezveřejňuje, seznam v sekci Co budete potřebovat jsme sestavili z jeho CAD a dokumentace. Hotovou sadu možná nabídneme později; chcete-li o ní vědět, nechte e-mail ve formuláři nahoře.' : 'Ne, nic neprodáváme. Díly koupíte přímo u dodavatelů podle kusovníku projektu (sekce Co budete potřebovat). Hotovou sadu možná nabídneme později; chcete-li o ní vědět, nechte e-mail ve formuláři nahoře.')],
    ['Jste spojeni s autory projektu?', 'Ne. Vycházíme z otevřené dokumentace projektu ' + r.name + ' (' + r.author + ', licence ' + r.hw + '). Autoři s námi nejsou spojeni a tuto stránku neschválili.'],
    ['Jaký software budu potřebovat?', r.cat === 'combat' ? 'Žádný. Robot se ovládá RC vysílačem FlySky; přijímač Malenki Nano s ním jen spárujete, programovat nic nemusíte. Návod projektu najdete v sekci Licence a bezpečnost.'
      : r.noSoftware ? r.software + '. Návod projektu najdete v sekci Licence a bezpečnost.'
      : (window.PR_NO_SW(r) || r.rcControl) ? 'Žádný. Ovládá se běžným RC vysílačem, programovat nic nemusíte.' + (r.noGuide ? ' Projekt návod na sestavení nemá; repozitář obsahuje seznam dílů a videa.' : ' Návod projektu najdete v sekci Licence a bezpečnost.')
      : r.swNotFree ? r.software + '. Část potřebného softwaru není zdarma; odkaz na návod projektu najdete v sekci Licence a bezpečnost.'
      : r.software + '. Software je open-source a zdarma; odkaz na návod projektu najdete v sekci Licence a bezpečnost.'],
    ['Je stavba vhodná pro děti?', 'Není to hračka. ' + (r.cat === 'lab' ? 'Sestava' : 'Robot') + ' obsahuje malé díly' + (r.noElectronics ? '' : ' a elektroniku') + '; stavba je určena osobám od 14 let, mladším pouze pod dohledem dospělého, například ve škole nebo kroužku.'],
    ['Jsme škola nebo kroužek. Co nám nabízíte?', (cad ? 'Nic neprodáváme ani nefakturujeme. Zdarma je hodina se simulací SO-101 a pracovní list na stránce Pro školy; díly koupíte u dodavatelů podle seznamu sestaveného z CAD a dokumentace projektu.' : 'Nic neprodáváme ani nefakturujeme. Zdarma je hodina se simulací SO-101 a pracovní list na stránce Pro školy; díly koupíte u dodavatelů podle kusovníku projektu.')]
  ];
};
window.PR_SPECS = function (r) {
  return r.specs.concat([['Náročnost', r.level], ['Software', r.software], ['Náklady na díly dle autora', r.bomCost]])
    .filter(function (s) { return s[1] && String(s[1]).trim() !== '—'; });
};
window.PR_LICENSES = [
  ['Apache-2.0', 'y', 'Ano', 'Kopie licence, uvedení autora, označení změn'],
  ['MIT', 'y', 'Ano', 'Kopie licence a copyright autora'],
  ['CC BY 4.0', 'y', 'Ano', 'Uvedení autora, odkaz na zdroj a licenci'],
  ['CC BY-SA 4.0', 'c', 'Ano, s podmínkou', 'Upravené soubory zveřejňujeme pod stejnou licencí'],
  ['GPL-3.0', 'c', 'Ano, s podmínkou', 'Zdrojové soubory upravených dílů a firmwaru k dispozici'],
  ['CERN-OHL-P-2.0', 'y', 'Ano', 'Uvedení autorů a licence'],
  ['CERN-OHL-W / -S 2.0', 'c', 'Ano, s podmínkou', 'Zdroje upravené konstrukce zveřejňujeme'],
  ['CERN-OHL-1.2', 'c', 'Ano, s podmínkou', 'Kopie licence, označení změn s datem, upravené zdroje pod stejnou licencí'],
  ['CC BY-NC / vlastní NC', 'n', 'Ne', 'Pouze s písemným svolením autora']
];

// ---------- licence -> rights ----------
// r.license = { hw, sw?, docs?, policy?, status, checked, sources[] }; each value is an SPDX id, an array of
// candidate ids (unconfirmed: the stricter one wins) or 'own' (our original design). Rights are derived, never
// typed in, so they cannot drift from the licence. Values: 'yes' | 'conditions' | 'no' | 'ask'.
//   sell_prints       print and sell the project's parts
//   sell_kits         sell a kit (prints + hardware + firmware/software as shipped)
//   renders_from_cad  publish our renders made from the project's CAD on a commercial site
//   accessories       sell our own accessories designed to fit (no copying of their CAD)
//   guide             publish our own guide (own text and photos; quotes follow the doc licence)
//   plan              publish a parts-buying plan (we link suppliers, we sell nothing)
// Classes: own | permissive | copyleft (GPL, LGPL, CC BY-SA, CERN-OHL-W/-S) | nd | nc | proprietary | unknown.
window.PR_LICENSE_CLASS = function (id) {
  var s = String(id == null ? '' : id).trim().toUpperCase().replace(/[\s_]+/g, '-');
  if (!s || s === '—' || s === '-') return 'unknown';
  if (s === 'OWN') return 'own';
  if (/PROPRIETARY|ALL-RIGHTS|LICENSEREF/.test(s)) return 'proprietary';
  if (/(^|-)NC(-|$)/.test(s) || /NONCOMMERCIAL/.test(s)) return 'nc';
  if (/(^|-)ND(-|$)/.test(s)) return 'nd';
  if (/^(A?GPL|LGPL|CERN-OHL-[WS]|CERN-OHL-1\.[12]$)|^CC-BY-SA|^MPL|^EUPL|^TAPR-OHL/.test(s)) return 'copyleft';
  if (/^(MIT|APACHE|BSD|ISC|ZLIB|0BSD|UNLICENSE|CC0|CC-BY(-[0-9.]+)?$|CERN-OHL-P|SOLDERPAD)/.test(s)) return 'permissive';
  return 'unknown';
};
(function () {
  var ORDER = ['own', 'permissive', 'copyleft', 'nd', 'unknown', 'nc', 'proprietary'];   // later = stricter
  var Y = 'yes', C = 'conditions', N = 'no', A = 'ask';
  // per class: [sell_prints, renders_from_cad, accessories, kit part]
  var HW = {
    own: [Y, Y, Y, Y], permissive: [Y, Y, Y, Y],
    copyleft: [C, C, Y, C],           // share-alike: modified design files published under the same licence
    nd: [C, A, Y, C],                 // verbatim copies only; a render may count as an adaptation
    unknown: [A, A, Y, A], nc: [N, N, Y, N], proprietary: [N, N, Y, N]
  };
  var SW = { own: Y, permissive: Y, copyleft: C, nd: C, unknown: A, nc: N, proprietary: N };   // shipping firmware/software in a kit
  var RANK = { yes: 0, conditions: 1, ask: 2, no: 3 };
  function strictest(v) {
    var list = Array.isArray(v) ? v : [v], best = null;
    list.forEach(function (x) { var c = window.PR_LICENSE_CLASS(x); if (best === null || ORDER.indexOf(c) > ORDER.indexOf(best)) best = c; });
    return best || 'unknown';
  }
  function worse(a, b) { return RANK[a] >= RANK[b] ? a : b; }
  window.PR_DERIVE_RIGHTS = function (lic) {
    lic = lic || {};
    var hw = strictest(lic.hw), sw = lic.sw == null || lic.sw === '—' ? null : strictest(lic.sw);
    var h = HW[hw];
    var kit = sw ? worse(h[3], SW[sw]) : h[3];
    if (lic.policy) kit = worse(kit, SW[strictest(lic.policy)]);
    return {
      class: hw, sw_class: sw,
      sell_prints: h[0], sell_kits: kit, renders_from_cad: h[1], accessories: h[2],
      guide: Y, plan: Y,
      unverified: lic.status !== 'verified',
      trademark: !!lic.trademark   // names/logos need the owner's permission whatever the licence says
    };
  };
  window.PR_RIGHTS = function (r) { return window.PR_DERIVE_RIGHTS(r.license || { hw: r.hw, sw: r.sw }); };
})();

// Robots of the arena (sim/arena) that are not catalogue kits: licence of our own models.
window.PR_ARENA_LICENSES = {
  // original designs, printedrobotics.cz; published as CC BY 4.0 (tools/robots-cad/kosa.py, klepeto.py headers)
  kosa: { hw: 'own', status: 'verified', checked: '2026-10-30', published: 'CC-BY-4.0', sources: ['tools/robots-cad/kosa.py'] },
  klepeto: { hw: 'own', status: 'verified', checked: '2026-10-30', published: 'CC-BY-4.0', sources: ['tools/robots-cad/klepeto.py'] }
};

// Showcases: open projects we present but do not sell (no kit page, no order form). The catalogue shows them
// after the kits with a card that links to the simulation (sim/<r.sim>/). Every number names its upstream source.
window.PR_SHOWCASE = [
  { id: 'origin', showcase: true, buy: false, sim: 'origin', name: 'ROBOTO ORIGIN', type: 'Humanoidní robot', cat: 'legged', level: 'Pokročilý',
    author: 'RoboParty',   // legal name as in the upstream README: Shanghai RoboParty Technology Co., Ltd. (city of the team not stated as a fact here)
    alt: 'Humanoid ROBOTO ORIGIN v simulaci: černá hliníková kostra se 23 klouby na podlaze s mřížkou',
    card: [['Licence', 'CERN-OHL-W-2.0 · GPL-3.0'], ['Klouby', '23']],
    notAffiliated: 'Nejsme s RoboParty spojeni, díly neprodáváme.',
    badge: 'Ukázka · otevřený hardware CERN-OHL-W-2.0 · software GPL-3.0',
    short: 'Otevřený humanoid s 23 klouby z frézovaného hliníku: konstrukce, elektronika, trénink chůze i nasazení zveřejněné jako open source.',
    lead: 'Prototyp humanoida, který podle autorů vznikl za čtyři měsíce. RoboParty zveřejnila CAD, desky plošných spojů, kusovník, model pro simulaci, trénink v Isaac Lab a nasazení v ROS 2 včetně naučených politik. Podle autorů jde sestavit z dílů z Taobao a zakázkové výroby. Ukazujeme ho jako inspiraci – díly ani sady k němu neprodáváme a s autory nejsme spojeni.',
    note: 'Konstrukce je frézovaný hliník; tisknou se jen kalibrační přípravky, takže „tiskové“ sady tu nedávají smysl.',
    repo: 'https://github.com/Roboparty/roboto_origin', docs: 'https://roboparty.com/roboto_origin/doc',
    upstream: { commit: 'c71fd9287d28104dca111d7c25b908fa3f45f8e4', date: '2026-08-18', checked: '2026-10-30' },
    // [label, value, source path in Roboparty/roboto_origin @ commit above]
    specs: [
      ['Stupně volnosti', '23 (nohy 2× 6, pas 1, ruce 2× 5)', 'modules/rpo_description/mjcf/rpo.xml'],
      ['Pohony', '14× Damiao DM-4340P (48 V), 9× DM-10010L', 'assets/BOM_EN.md (v1.0.1); rpo_hardware 散件清单 V1.1.3'],
      ['Napájení', 'Li-ion 48 V, 15 Ah', 'assets/BOM_EN.md'],
      ['Řídicí počítač', 'RDK X5 8 GB', 'assets/BOM_EN.md; rpo_hardware 散件清单 V1.1.3'],
      ['Sběrnice', 'CAN, 4 linky (6 + 7 + 5 + 5 motorů)', 'modules/roboparty_deploy/src/inference/robots/rpo/robot.yaml'],
      ['Konstrukce', 'CNC hliník 6061/7075, černý elox; ocelová táhla', 'modules/rpo_hardware/V2.0/…/A2_CNCBOM.xlsx'],
      ['Chůze', 'RL politika (ONNX), 50 Hz, příkaz vpřed −0,4 až 0,6 m/s', 'modules/roboparty_deploy/…/configs/default.yaml'],
      ['Software', 'ROS 2 Humble, Isaac Lab 2.1, MuJoCo sim2sim', 'README.md'],
      ['Díly dle autora', '49 713 CNY (kusovník v1.0.1, 5. 1. 2026)', 'assets/BOM_EN.md']
    ],
    license: { hw: 'CERN-OHL-W-2.0', sw: 'GPL-3.0-only', docs: 'CC-BY-SA-4.0', policy: 'GPL-3.0-only', trademark: true,
      status: 'verified', checked: '2026-10-30',
      notes: 'Popis robota (MJCF, meshe), CAD, DPS a kusovník: CERN-OHL-W-2.0; software a firmware: GPL-3.0-only (orangepi-build GPL-2.0, usb2can Apache-2.0); dokumentace: CC BY-SA 4.0; trénink: BSD-3-Clause, parkour část CC BY-NC 4.0; díly dodavatelů nejsou licencované. Názvy RoboParty, RPO a Roboto Origin jsou ochranné známky.',
      sources: ['https://github.com/Roboparty/roboto_origin/blob/main/LICENSES.md', 'https://github.com/Roboparty/rpo_hardware/blob/main/LICENSES.md',
        'https://github.com/Roboparty/rpo_description/blob/main/README.md', 'https://github.com/Roboparty/rpo_hardware/blob/main/TRADEMARKS.md'] } }
];

// derived rights on every entry that carries a licence (catalogue kits and showcases)
window.PR_ROBOTS.concat(window.PR_SHOWCASE).forEach(function (r) { r.rights = window.PR_RIGHTS(r); });
Object.keys(window.PR_ARENA_LICENSES).forEach(function (k) { window.PR_ARENA_LICENSES[k].rights = window.PR_DERIVE_RIGHTS(window.PR_ARENA_LICENSES[k]); });
