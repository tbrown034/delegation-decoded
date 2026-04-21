export interface StateInfo {
  code: string;
  name: string;
  fipsCode: string;
  numDistricts: number;
}

export const STATES: StateInfo[] = [
  { code: "AL", name: "Alabama", fipsCode: "01", numDistricts: 7 },
  { code: "AK", name: "Alaska", fipsCode: "02", numDistricts: 1 },
  { code: "AZ", name: "Arizona", fipsCode: "04", numDistricts: 9 },
  { code: "AR", name: "Arkansas", fipsCode: "05", numDistricts: 4 },
  { code: "CA", name: "California", fipsCode: "06", numDistricts: 52 },
  { code: "CO", name: "Colorado", fipsCode: "08", numDistricts: 8 },
  { code: "CT", name: "Connecticut", fipsCode: "09", numDistricts: 5 },
  { code: "DE", name: "Delaware", fipsCode: "10", numDistricts: 1 },
  { code: "FL", name: "Florida", fipsCode: "12", numDistricts: 28 },
  { code: "GA", name: "Georgia", fipsCode: "13", numDistricts: 14 },
  { code: "HI", name: "Hawaii", fipsCode: "15", numDistricts: 2 },
  { code: "ID", name: "Idaho", fipsCode: "16", numDistricts: 2 },
  { code: "IL", name: "Illinois", fipsCode: "17", numDistricts: 17 },
  { code: "IN", name: "Indiana", fipsCode: "18", numDistricts: 9 },
  { code: "IA", name: "Iowa", fipsCode: "19", numDistricts: 4 },
  { code: "KS", name: "Kansas", fipsCode: "20", numDistricts: 4 },
  { code: "KY", name: "Kentucky", fipsCode: "21", numDistricts: 6 },
  { code: "LA", name: "Louisiana", fipsCode: "22", numDistricts: 6 },
  { code: "ME", name: "Maine", fipsCode: "23", numDistricts: 2 },
  { code: "MD", name: "Maryland", fipsCode: "24", numDistricts: 8 },
  { code: "MA", name: "Massachusetts", fipsCode: "25", numDistricts: 9 },
  { code: "MI", name: "Michigan", fipsCode: "26", numDistricts: 13 },
  { code: "MN", name: "Minnesota", fipsCode: "27", numDistricts: 8 },
  { code: "MS", name: "Mississippi", fipsCode: "28", numDistricts: 4 },
  { code: "MO", name: "Missouri", fipsCode: "29", numDistricts: 8 },
  { code: "MT", name: "Montana", fipsCode: "30", numDistricts: 2 },
  { code: "NE", name: "Nebraska", fipsCode: "31", numDistricts: 3 },
  { code: "NV", name: "Nevada", fipsCode: "32", numDistricts: 4 },
  { code: "NH", name: "New Hampshire", fipsCode: "33", numDistricts: 2 },
  { code: "NJ", name: "New Jersey", fipsCode: "34", numDistricts: 12 },
  { code: "NM", name: "New Mexico", fipsCode: "35", numDistricts: 3 },
  { code: "NY", name: "New York", fipsCode: "36", numDistricts: 26 },
  { code: "NC", name: "North Carolina", fipsCode: "37", numDistricts: 14 },
  { code: "ND", name: "North Dakota", fipsCode: "38", numDistricts: 1 },
  { code: "OH", name: "Ohio", fipsCode: "39", numDistricts: 15 },
  { code: "OK", name: "Oklahoma", fipsCode: "40", numDistricts: 5 },
  { code: "OR", name: "Oregon", fipsCode: "41", numDistricts: 6 },
  { code: "PA", name: "Pennsylvania", fipsCode: "42", numDistricts: 17 },
  { code: "RI", name: "Rhode Island", fipsCode: "44", numDistricts: 2 },
  { code: "SC", name: "South Carolina", fipsCode: "45", numDistricts: 7 },
  { code: "SD", name: "South Dakota", fipsCode: "46", numDistricts: 1 },
  { code: "TN", name: "Tennessee", fipsCode: "47", numDistricts: 9 },
  { code: "TX", name: "Texas", fipsCode: "48", numDistricts: 38 },
  { code: "UT", name: "Utah", fipsCode: "49", numDistricts: 4 },
  { code: "VT", name: "Vermont", fipsCode: "50", numDistricts: 1 },
  { code: "VA", name: "Virginia", fipsCode: "51", numDistricts: 11 },
  { code: "WA", name: "Washington", fipsCode: "53", numDistricts: 10 },
  { code: "WV", name: "West Virginia", fipsCode: "54", numDistricts: 2 },
  { code: "WI", name: "Wisconsin", fipsCode: "55", numDistricts: 8 },
  { code: "WY", name: "Wyoming", fipsCode: "56", numDistricts: 1 },
  // Territories and DC — included because they have delegates in Congress
  { code: "DC", name: "District of Columbia", fipsCode: "11", numDistricts: 1 },
  { code: "AS", name: "American Samoa", fipsCode: "60", numDistricts: 1 },
  { code: "GU", name: "Guam", fipsCode: "66", numDistricts: 1 },
  { code: "MP", name: "Northern Mariana Islands", fipsCode: "69", numDistricts: 1 },
  { code: "PR", name: "Puerto Rico", fipsCode: "72", numDistricts: 1 },
  { code: "VI", name: "U.S. Virgin Islands", fipsCode: "78", numDistricts: 1 },
];

export const STATE_BY_CODE = Object.fromEntries(
  STATES.map((s) => [s.code, s])
);
