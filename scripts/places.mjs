// The places Arrow Lakes Atlas compares, and the census subdivisions (CSDs) their figures come from.
//
// Coordinates are OpenStreetMap place nodes (checked 2026-11-11 through Overpass). The CSD each
// place sits in comes from Nominatim's reverse lookup (regional district electoral areas) and
// Statistics Canada's 2021 CSD codes (from table 17-10-0155-01).
//
// There are no First Nations reserves on the Arrow Lakes today. The lakes are the heart of the
// territory of the Sinixt (Arrow Lakes) people; the atlas says so on its opening panel.

/** Census subdivisions around the Arrow Lakes (2021 boundaries, Statistics Canada codes). */
export const CSDS = [
  { csd: '5939019', name: 'Revelstoke', seat: 'revelstoke' },
  { csd: '5939023', name: 'Columbia-Shuswap B (Shelter Bay/Mica Creek)', short: 'CSRD Area B', seat: 'beaton' },
  { csd: '5903050', name: 'Nakusp', seat: 'nakusp' },
  { csd: '5903060', name: 'Central Kootenay K (The Arrow Lakes)', short: 'Area K · Arrow Lakes', seat: 'burton' },
  { csd: '5903058', name: 'Central Kootenay J (Lower Arrow/Columbia)', short: 'Area J · Lower Arrow', seat: 'robson' },
  { csd: '5903056', name: 'Central Kootenay I (Sentinel Mountain)', short: 'Area I · Sentinel Mtn', seat: 'brilliant' },
  { csd: '5903045', name: 'Castlegar', seat: 'castlegar' },
];

/** key, name, CSD code, lon, lat, kind, optional note */
export const PLACES = [
  { key: 'revelstoke', name: 'Revelstoke', csd: '5939019', lon: -118.1957, lat: 50.998, kind: 'city', note: 'The city at the head of the valley, on the Trans-Canada Highway. The Columbia flows south from here toward the Upper Arrow Lake.' },
  { key: 'beaton', name: 'Beaton', csd: '5939023', lon: -117.7288, lat: 50.7351, kind: 'hamlet', note: 'A quiet settlement at the head of the lake’s northeast arm, near the old Arrowhead landing.' },
  { key: 'halcyon', name: 'Halcyon', csd: '5903060', lon: -117.8982, lat: 50.5173, kind: 'hamlet', note: 'Home of Halcyon Hot Springs on the Upper Arrow Lake’s east shore.' },
  { key: 'nakusp', name: 'Nakusp', csd: '5903050', lon: -117.7974, lat: 50.2396, kind: 'village', note: 'The main town on the Arrow Lakes, with the Arrow Lakes Hospital, a waterfront walkway and hot springs up the Kuskanax valley.' },
  { key: 'east-arrow-park', name: 'East Arrow Park', csd: '5903060', lon: -117.918, lat: 50.0899, kind: 'hamlet' },
  { key: 'burton', name: 'Burton', csd: '5903060', lon: -117.8801, lat: 49.9868, kind: 'village', note: 'Rebuilt on higher ground when the reservoir flooded the old townsite in 1968.' },
  { key: 'fauquier', name: 'Fauquier', csd: '5903060', lon: -118.0724, lat: 49.8715, kind: 'village', note: 'The east landing of the Needles cable ferry, which carries Highway 6 across the lake toward the Okanagan.' },
  { key: 'needles', name: 'Needles', csd: '5903060', lon: -118.1034, lat: 49.8727, kind: 'hamlet' },
  { key: 'edgewood', name: 'Edgewood', csd: '5903060', lon: -118.144, lat: 49.7812, kind: 'village', note: 'Moved up the hillside in the 1960s, when the reservoir drowned the original village.' },
  { key: 'pass-creek', name: 'Pass Creek', csd: '5903056', lon: -117.677, lat: 49.3847, kind: 'hamlet' },
  { key: 'robson', name: 'Robson', csd: '5903058', lon: -117.6968, lat: 49.3344, kind: 'village', note: 'On the north shore of the Columbia just above the Hugh Keenleyside Dam, which holds back the Arrow Lakes.' },
  { key: 'castlegar', name: 'Castlegar', csd: '5903045', lon: -117.6668, lat: 49.325, kind: 'city', note: 'The city at the foot of the lakes, where the Kootenay River joins the Columbia. West Kootenay Regional Airport is here.' },
  { key: 'brilliant', name: 'Brilliant', csd: '5903056', lon: -117.6417, lat: 49.3211, kind: 'village' },
  { key: 'ootischenia', name: 'Ootischenia', csd: '5903058', lon: -117.6283, lat: 49.2851, kind: 'village' },
];

/**
 * Fallback points for drive-time destinations, used only if the OpenStreetMap lookup in the
 * pipeline finds nothing (approximate; the router snaps each point to the nearest road).
 */
export const DESTINATIONS = {
  city: { name: 'Kootenay Boundary Regional Hospital, Trail', lon: -117.7095, lat: 49.0939 },
  airport: { name: 'West Kootenay Regional Airport, Castlegar', lon: -117.6322, lat: 49.2963 },
  kelowna: { name: 'Kelowna General Hospital', lon: -119.4936, lat: 49.8714 },
};
