/**
 * Diamond Orthotic catalog — publicly purchasable accessories, supplies, and tools.
 * Orthotics (OND/ONP/DDSO) are Rx-only and live in products.js, not here.
 *
 * Image paths normalized to `/catalog/<filename>`. Images should be dropped
 * into `apps/web/public/catalog/`. Missing images fall back to a placeholder.
 * Products with category "Digital Rx." or "@Digital Rx." are Rx-only —
 * shown in the catalog for discovery but routed to the Digital Rx form.
 */

function file(path) {
  if (!path) return null;
  // "assets/images/foo.jpg" → "/catalog/foo.jpg"
  // "assets/images/thumbnails/foo_thumbnail.jpg" → "/catalog/thumbnails/foo_thumbnail.jpg"
  return "/catalog/" + path.replace(/^assets\/images\//, "");
}

function parseCats(raw) {
  // "TMJ@Digital Rx." → ["TMJ", "Digital Rx."]
  return raw.split("@").map((c) => c.trim()).filter(Boolean);
}

function isRxOnly(raw) {
  return parseCats(raw).some((c) => c.toLowerCase().includes("digital rx"));
}

const RAW = [
  { id: "16",  name: "NovaDent IP — 1 Box", img: "NovaDent IP.jpg", thumb: "thumbnails/NovaDent IP_thumbnail.jpg", price: 15, cats: "Products", stock: 191 },
  { id: "18",  name: "Diamond Rechargeable Sonic Cleaner", img: "diamo-sonic_cleaner.png", thumb: "thumbnails/diamo-sonic_cleaner_thumbnail.png", price: 20, cats: "Tools", stock: 952 },
  { id: "20",  name: "Bands (1 Pair)", img: "ddsostraps_orangeblue(17mm-21mm).jpg", thumb: "thumbnails/DDSOStraps_OrangeBlue(17mm-21mm)_thumbnail.jpg", price: 4, cats: "Products", stock: -51227 },
  { id: "24",  name: "Diamond Best Bite (Rainbow Specialty)", desc: "Includes 2 tips per cartridge · 2 cartridges", img: "Diamond Best Bite (Rainbow Specialty).jpg", thumb: "thumbnails/Diamond Best Bite (Rainbow Specialty)_thumbnail.jpg", price: 15.5, cats: "Mouth Guards", stock: 994 },
  { id: "25",  name: "Nylon Adjusting Burs (5 pcs.)", img: "Nylon Adjusting Burs.jpg", thumb: "thumbnails/Nylon Adjusting Burs_thumbnail.jpg", price: 135, cats: "Tools", stock: 1000 },
  { id: "26",  name: "Nylon Adjusting Burs (single)", img: "Nylon Adjusting Burs.jpg", thumb: "thumbnails/Nylon Adjusting Burs_thumbnail.jpg", price: 30, cats: "Tools", stock: 999 },
  { id: "27",  name: "Sample Diamond Polishing Buffs", desc: "Includes 1 each fine, medium, coarse, Hi Shine, and Polish.", img: "Sample Diamond Polishing Buffs_1.png", thumb: "thumbnails/Sample Diamond Polishing Buffs_1_thumbnail.jpg", price: 10, cats: "Tools", stock: 1000 },
  { id: "28",  name: "Diamond Polishing Burs — Soft Green (10 pk)", img: "Diamond Polishing Burs Soft Green (10 pk).jpg", thumb: "thumbnails/diamond polishing burs soft green (10 pk)_thumbnail.jpg", price: 20, cats: "Tools", stock: 1000 },
  { id: "29",  name: "Diamond Polishing Burs — Medium (10 pk)", img: "Diamond Polishing Burs Med (10 pk) 2000 amt.jpg", thumb: "thumbnails/diamond polishing burs med (10 pk) 2000 amt_thumbnail.jpg", price: 20, cats: "Tools", stock: 1000 },
  { id: "30",  name: "Diamond Polishing Burs — Coarse (10 pk)", img: "Diamond Polishing Bur Coarse (10 pk) 2000 amt.jpg", thumb: "thumbnails/diamond polishing bur coarse (10 pk) 2000 amt_thumbnail.jpg", price: 20, cats: "Tools", stock: 1000 },
  { id: "31",  name: "Thermo (Crimping) Pliers — Dentsply Sirona", img: "Thermo (Crimping) Pliers- (Dentsply Sirona).jpg", thumb: "thumbnails/thermo (crimping) pliers- (dentsply sirona)_thumbnail.jpg", price: 140, cats: "Tools", stock: 998 },
  { id: "32",  name: "Heating Torch", img: "Heating Torch_1.jpg", thumb: "thumbnails/Heating Torch_1_thumbnail.jpg", price: 9.99, cats: "Tools", stock: 1000 },
  { id: "41",  name: "TAP", img: "TAP- 275.jpg", thumb: "thumbnails/TAP- 275_thumbnail.jpg", price: 375, cats: "Tools", stock: 1000 },
  { id: "50",  name: "Shipping Supply Kits", img: null, thumb: null, price: 0, cats: "Tools", stock: 0 },
  { id: "51",  name: "Additional Shipping Supplies", img: "Additional shipping supplies.jpg", thumb: "thumbnails/Additional shipping supplies_thumbnail.jpg", price: 0, cats: "Tools", stock: 9999 },
  { id: "52",  name: "Small White Box", img: "Small white box amt1.jpg", thumb: "thumbnails/Small white box amt1_thumbnail.jpg", price: 0, cats: "Tools", stock: 999 },
  { id: "53",  name: "FedEx Purple Shipping Pouch (Amt)", img: null, thumb: null, price: 0, cats: "Tools", stock: 0 },
  { id: "54",  name: "FedEx Purple Shipping Pouch (Amt)", img: null, thumb: null, price: 0, cats: "Tools", stock: 0 },
  { id: "55",  name: "FedEx Box", img: null, thumb: null, price: 0, cats: "Tools", stock: 0 },
  { id: "58",  name: "Diamond (PMT/Acrylic) Sample Models", img: "1-olmosdaynightappliances_nonasaldilators_names.jpg", thumb: "thumbnails/1-OlmosDayNightAppliances_NoNasalDilators_NAMES_thumbnail.jpg", price: 125, cats: "TMJ@Digital Rx.", stock: 962 },
  { id: "59",  name: "Diamond Sample Models", img: "1-olmosnight (printed-nylon)_nonasaldilators_names.jpg", thumb: "thumbnails/1-OlmosNight (Printed-Nylon)_NONasalDilators_NAMES_thumbnail.jpg", price: 175, cats: "TMJ@Digital Rx.", stock: 984 },
  { id: "61",  name: "Mute", desc: "Small / Medium / Large", img: "mute(smallmedium large).jpg", thumb: "thumbnails/Mute(SmallMedium Large)_thumbnail.jpg", price: 21.99, cats: "Sleep", stock: 247 },
  { id: "62",  name: "Mute — Trial Pack", img: "Mute_TrialPack.jpg", thumb: "thumbnails/Mute_TrialPack_thumbnail.jpg", price: 14.99, cats: "Sleep", stock: 945 },
  { id: "63",  name: "DDSO Sample Models", img: "ddso(diamonddigitalsleeporthotic)_nonasaldilators.jpg", thumb: "thumbnails/DDSO(DiamondDigitalSleepOrthotic)_NoNasalDilators_thumbnail.jpg", price: 150, cats: "Digital Rx.@Sleep", stock: 9970 },
  { id: "67",  name: "SomnoMed Sample Models", img: "1- somnomed-names.jpg", thumb: "thumbnails/1- SomnoMed-NAMES_thumbnail.jpg", price: 300, cats: "Sleep", stock: 999 },
  { id: "70",  name: "Shirazi Hybrid (Printed Nylon)", img: "shirazihybrid(printed-nylon).jpg", thumb: "thumbnails/ShiraziHybrid(PRINTED-NYLON)_thumbnail.jpg", price: 500, cats: "Sleep", stock: 1000 },
  { id: "72",  name: "Diamond D Scan", img: "diamond d scan.jpg", thumb: "thumbnails/Diamond D Scan_thumbnail.jpg", price: 15, cats: "Products", stock: -356 },
  { id: "73",  name: "Diamond Bite Sticks", img: "Diamon Bite Sticks.jpg", thumb: "thumbnails/Diamon Bite Sticks_thumbnail.jpg", price: 15, cats: "Products", stock: -121 },
  { id: "74",  name: "Diamond Impression Material", img: "diamond impression material.jpg", thumb: "thumbnails/Diamond Impression Material_thumbnail.jpg", price: 12, cats: "Products", stock: 820 },
  { id: "75",  name: "Replacement Vertical Shim (Anterior)", img: "ReplacementVerticalShims_ANTERIOR.jpg", thumb: "thumbnails/ReplacementVerticalShims_ANTERIOR_thumbnail.jpg", price: 3, cats: "Products", stock: 871 },
  { id: "76",  name: "Replacement Vertical Shims (Posterior)", img: "replacementverticalshims_anterior.jpg", thumb: "thumbnails/ReplacementVerticalShims_ANTERIOR_thumbnail.jpg", price: 6, cats: "Products", stock: 833 },
  { id: "77",  name: "Dr. B's Cleanadent Liquid", img: "drbscleanadentliquid-1.jpg", thumb: "thumbnails/DrBsCleanadentLiquid-1_thumbnail.jpg", price: 10.95, cats: "Products", stock: 926 },
  { id: "78",  name: "Dr. B's Sonic Cleaner", img: "DrBsSonicCleaner.jpg", thumb: "thumbnails/DrBsSonicCleaner_thumbnail.jpg", price: 14.95, cats: "Products", stock: 944 },
  { id: "83",  name: "NovaDent Cleaner IP Formula — 1 Box", img: "NovaDentCleanerIP.jpg", thumb: "thumbnails/NovaDentCleanerIP_thumbnail.jpg", price: 15, cats: "Orthodontics@Products", stock: -593 },
  { id: "84",  name: "NovaDent Cleaner IP Formula", img: "novadentcleanerip.jpg", thumb: "thumbnails/NovaDentCleanerIP_thumbnail.jpg", price: 13.5, cats: "Orthodontics", stock: 807 },
  { id: "85",  name: "NovaDent Cleaner IP Formula", img: "novadentcleanerip.jpg", thumb: "thumbnails/NovaDentCleanerIP_thumbnail.jpg", price: 23, cats: "Orthodontics", stock: 702 },
  { id: "87",  name: "True Functional Airway Nasal Spray", img: "True Function Airway Nasal Spray.jpg", thumb: "thumbnails/True Function Airway Nasal Spray_thumbnail.jpg", price: 21.99, cats: "Products", stock: 860 },
  { id: "88",  name: "X-Clear Nasal Spray", img: "Xlear Nasal Spray.jpg", thumb: "thumbnails/Xlear Nasal Spray_thumbnail.jpg", price: 21.99, cats: "Orthodontics", stock: 999 },
  { id: "90",  name: "Thermforming Crimpers", img: "thermformingcrimpers.jpg", thumb: "thumbnails/ThermformingCrimpers_thumbnail.jpg", price: 125, cats: "Products", stock: 973 },
  { id: "91",  name: "Nylon Adjusting Burs", img: "thumbnails/61ffujos9s_sl1500__thumbnail.jpg", thumb: "thumbnails/thumbnails/61FfUJoS9S_SL1500__thumbnail.jpg", price: 135, cats: "Products", stock: 970 },
  { id: "92",  name: "Single Nylon Adjusting Bur", img: "acrylic_bur.png", thumb: "thumbnails/acrylic_bur_thumbnail.png", price: 31.99, cats: "Products", stock: 817 },
  { id: "93",  name: "Sample Polishing Wheels", img: "polishwheels(sample).jpg", thumb: "thumbnails/PolishWheels(Sample)_thumbnail.jpg", price: 12, cats: "Products", stock: 912 },
  { id: "94",  name: "Polishing Wheels", img: "polishwheels(specific).jpg", thumb: "thumbnails/PolishWheels(Specific)_thumbnail.jpg", price: 20, cats: "Products", stock: 928 },
  { id: "95",  name: "FedEx Boxes — Small, Medium, or Large", img: "fedexboxes(smallmediumlarge).jpg", thumb: "thumbnails/FedexBoxes(SmallMediumLarge)_thumbnail.jpg", price: 0, cats: "Orthodontics", stock: 990 },
  { id: "96",  name: "FedEx Paks — Small or Large", img: "FedexPaks.jpg", thumb: "thumbnails/FedexPaks_thumbnail.jpg", price: 0, cats: "Orthodontics", stock: 972 },
  { id: "97",  name: "FedEx Shipping Pouch — One Size", img: "FedExShippingPouch.jpg", thumb: "thumbnails/FedExShippingPouch_thumbnail.jpg", price: 0, cats: "Orthodontics", stock: 980 },
  { id: "98",  name: "Shipping Supply Kit", img: "ShippingSupplyKit.jpg", thumb: "thumbnails/ShippingSupplyKit_thumbnail.jpg", price: 0, cats: "Products", stock: 939 },
  { id: "102", name: "Replacement Modular Tongue Positioners", img: "ReplacementModularTonguePositioner.jpg", thumb: "thumbnails/ReplacementModularTonguePositioner_thumbnail.jpg", price: 10, cats: "Products", stock: 960 },
  { id: "103", name: "Heating Torch", img: "HeatingTorch.jpg", thumb: "thumbnails/HeatingTorch_thumbnail.jpg", price: 9.99, cats: "Products", stock: 992 },
  { id: "104", name: "New Client Welcome Kit", img: "newclientwelcomekit.jpg", thumb: "thumbnails/NewClientWelcomeKit_thumbnail.jpg", price: 0, cats: "Products", stock: 944 },
  { id: "105", name: "Diamond A Classic", img: "diamond a classic.jpg", thumb: "thumbnails/Diamond A Classic_thumbnail.jpg", price: 15, cats: "Products", stock: 9738 },
  { id: "25-2", name: "Nylon Adjusting Burs (5 pcs.)", img: "61ffujos9s_sl1500_.jpg", thumb: "thumbnails/61FfUJoS9S_SL1500__thumbnail.jpg", price: 135, cats: "Tools", stock: 999 },
  { id: "109", name: "Rx. OD — Diamoform (PMT)", img: "od-pmt.png", thumb: "thumbnails/od-pmt_thumbnail.jpg", price: 199, cats: "Digital Rx.", stock: 0 },
  { id: "112", name: "DDSO — Diamond Digital Sleep Orthotic", img: "ddso_transparent.png", thumb: "thumbnails/ddso_transparent_thumbnail.jpg", price: 450, cats: "Digital Rx.", stock: 0 },
];

export const CATALOG = RAW.map((p) => ({
  id: p.id,
  name: p.name,
  description: p.desc || "",
  price: p.price,
  stock: p.stock,
  image: file(p.img),
  thumbnail: file(p.thumb),
  images: p.img ? [file(p.img)] : [],
  categories: parseCats(p.cats),
  rxOnly: isRxOnly(p.cats),
}));

/** All distinct top-level categories for filter UI. */
export const CATEGORIES = Array.from(
  new Set(CATALOG.flatMap((p) => p.categories))
).sort();
