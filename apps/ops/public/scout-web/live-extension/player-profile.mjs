// Display-only player metadata; never affects scoring or recorded points.
const countryCodes = {"ALB": "AL", "ALG": "DZ", "AND": "AD", "ARE": "AE", "ARG": "AR", "ARM": "AM", "AUS": "AU", "AUT": "AT", "AZE": "AZ", "BEL": "BE", "BGR": "BG", "BHR": "BH", "BOL": "BO", "BRA": "BR", "BRN": "BH", "BUL": "BG", "CAN": "CA", "CHE": "CH", "CHI": "CL", "CHL": "CL", "CHN": "CN", "CIV": "CI", "CMR": "CM", "COD": "CD", "COL": "CO", "CRC": "CR", "CRI": "CR", "CRO": "HR", "CUB": "CU", "CYP": "CY", "CZE": "CZ", "DEN": "DK", "DEU": "DE", "DNK": "DK", "DOM": "DO", "ECU": "EC", "EGY": "EG", "ESA": "SV", "ESP": "ES", "EST": "EE", "FIN": "FI", "FRA": "FR", "GBR": "GB", "GEO": "GE", "GER": "DE", "GHA": "GH", "GRC": "GR", "GRE": "GR", "GTM": "GT", "GUY": "GY", "HKG": "HK", "HON": "HN", "HRV": "HR", "HUN": "HU", "IDN": "ID", "INA": "ID", "IND": "IN", "IRI": "IR", "IRL": "IE", "IRQ": "IQ", "ISL": "IS", "ISR": "IL", "ISV": "VI", "ITA": "IT", "JAM": "JM", "JOR": "JO", "JPN": "JP", "KAZ": "KZ", "KEN": "KE", "KGZ": "KG", "KOR": "KR", "KOS": "XK", "KSA": "SA", "KUW": "KW", "LAT": "LV", "LBN": "LB", "LIT": "LT", "LTU": "LT", "LUX": "LU", "LVA": "LV", "MAD": "MG", "MAR": "MA", "MAS": "MY", "MEX": "MX", "MLI": "ML", "MLT": "MT", "MNE": "ME", "MON": "MC", "NCA": "NI", "NED": "NL", "NGA": "NG", "NGR": "NG", "NLD": "NL", "NOR": "NO", "NZL": "NZ", "OMA": "OM", "PAK": "PK", "PAN": "PA", "PAR": "PY", "PER": "PE", "PHI": "PH", "POL": "PL", "POR": "PT", "PRT": "PT", "PRY": "PY", "QAT": "QA", "ROM": "RO", "ROU": "RO", "RSA": "ZA", "RUS": "RU", "SAU": "SA", "SEN": "SN", "SGP": "SG", "SIN": "SG", "SLO": "SI", "SRB": "RS", "SRI": "LK", "SUI": "CH", "SUR": "SR", "SVK": "SK", "SVN": "SI", "SWE": "SE", "THA": "TH", "TPE": "TW", "TTO": "TT", "TUN": "TN", "TUR": "TR", "TWN": "TW", "UAE": "AE", "UKR": "UA", "URU": "UY", "URY": "UY", "USA": "US", "UZB": "UZ", "VEN": "VE", "VIE": "VN", "VNM": "VN", "ZAF": "ZA"};
export function playerProfile(state, index) {
 const selected=state.selectedMatch;
 if(!selected || selected.names?.[index]!==state.setup.names[index])return {country:null,ranking:null};
 const source=selected.players?.[index];
 const value=typeof source?.country==='string'?source.country.trim().toUpperCase():'';
 const country=countryCodes[value]??(value==='IV'?'CI':/^[A-Z]{2}$/.test(value)?value:null);
 const ranking=Number.isSafeInteger(source?.ranking)&&source.ranking>0?source.ranking:null;
 return {country,ranking};
}
export function playerIdentity(name, profile, document=globalThis.document) {
 const identity=document.createElement('span');identity.className='player-identity';
 if(profile.country){const flag=document.createElement('span');flag.className='player-flag';flag.textContent=String.fromCodePoint(...[...profile.country].map(c=>127397+c.charCodeAt(0)));let country=profile.country;try{country=new Intl.DisplayNames(['en'],{type:'region'}).of(profile.country)}catch{}flag.setAttribute('role','img');flag.setAttribute('aria-label',country);flag.title=country;identity.append(flag);const countryLabel=document.createElement('small');countryLabel.className='player-country';countryLabel.textContent=country;identity.append(countryLabel);}
 const label=document.createElement('span');label.className='player-name';label.textContent=name;identity.append(label);
 if(profile.ranking){const rank=document.createElement('span');rank.className='player-ranking';rank.textContent='#'+profile.ranking;rank.title='Ranking from admin player profile';rank.setAttribute('aria-label','Ranking '+profile.ranking);identity.append(rank);}
 return identity;
}
