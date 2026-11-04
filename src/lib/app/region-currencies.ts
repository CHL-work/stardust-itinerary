/**
 * Pinned public currency defaults, NOT an expansion of the ledger's supported codes.
 * Unicode CLDR currencyData a198dbf17e1d2314a76b84b30904b87a5f8618bb:
 * https://github.com/unicode-org/cldr-json/blob/a198dbf17e1d2314a76b84b30904b87a5f8618bb/cldr-json/cldr-core/supplemental/currencyData.json
 * Current tender entries as of the review date; ISO 3166-1 territories only.
 * SIX ISO 4217 amendment 180 confirms Bulgaria EUR from 2026-01-01. Croatia
 * already uses EUR; Curaçao/Sint Maarten XCG and Zimbabwe ZWG replace old codes.
 * KH/USD and MO/HKD are practical local alternatives, not currency conversions.
 * Antarctica has no single local currency and intentionally has no default.
 */
export const REGION_CURRENCIES_REVIEWED = "2026-10-28";
export const SUGGESTION_EXCLUDED_CURRENCIES: ReadonlySet<string> = new Set([
  "XDR", "XSU", "HRK", "BGN", "CUC", "ZWL", "ANG",
]);

// First currency is the local default, remaining entries are explicit alternatives.
const pinnedRegionCurrencies = `
AD=EUR AE=AED AF=AFN AG=XCD AI=XCD AL=ALL AM=AMD AO=AOA AR=ARS AS=USD AT=EUR AU=AUD AW=AWG AX=EUR AZ=AZN
BA=BAM BB=BBD BD=BDT BE=EUR BF=XOF BG=EUR BH=BHD BI=BIF BJ=XOF BL=EUR BM=BMD BN=BND BO=BOB BQ=USD BR=BRL BS=BSD BT=BTN,INR BV=NOK BW=BWP BY=BYN BZ=BZD
CA=CAD CC=AUD CD=CDF CF=XAF CG=XAF CH=CHF CI=XOF CK=NZD CL=CLP CM=XAF CN=CNY CO=COP CR=CRC CU=CUP CV=CVE CW=XCG CX=AUD CY=EUR CZ=CZK
DE=EUR DJ=DJF DK=DKK DM=XCD DO=DOP DZ=DZD EC=USD EE=EUR EG=EGP EH=MAD ER=ERN ES=EUR ET=ETB
FI=EUR FJ=FJD FK=FKP FM=USD FO=DKK FR=EUR GA=XAF GB=GBP GD=XCD GE=GEL GF=EUR GG=GBP GH=GHS GI=GIP GL=DKK GM=GMD GN=GNF GP=EUR GQ=XAF GR=EUR GS=GBP GT=GTQ GU=USD GW=XOF GY=GYD
HK=HKD HM=AUD HN=HNL HR=EUR HT=HTG,USD HU=HUF ID=IDR IE=EUR IL=ILS IM=GBP IN=INR IO=USD IQ=IQD IR=IRR IS=ISK IT=EUR
JE=GBP JM=JMD JO=JOD JP=JPY KE=KES KG=KGS KH=KHR,USD KI=AUD KM=KMF KN=XCD KP=KPW KR=KRW KW=KWD KY=KYD KZ=KZT
LA=LAK LB=LBP LC=XCD LI=CHF LK=LKR LR=LRD LS=LSL,ZAR LT=EUR LU=EUR LV=EUR LY=LYD
MA=MAD MC=EUR MD=MDL ME=EUR MF=EUR MG=MGA MH=USD MK=MKD ML=XOF MM=MMK MN=MNT MO=MOP,HKD MP=USD MQ=EUR MR=MRU MS=XCD MT=EUR MU=MUR MV=MVR MW=MWK MX=MXN MY=MYR MZ=MZN
NA=NAD,ZAR NC=XPF NE=XOF NF=AUD NG=NGN NI=NIO NL=EUR NO=NOK NP=NPR NR=AUD NU=NZD NZ=NZD OM=OMR
PA=PAB,USD PE=PEN PF=XPF PG=PGK PH=PHP PK=PKR PL=PLN PM=EUR PN=NZD PR=USD PS=ILS,JOD PT=EUR PW=USD PY=PYG QA=QAR
RE=EUR RO=RON RS=RSD RU=RUB RW=RWF SA=SAR SB=SBD SC=SCR SD=SDG SE=SEK SG=SGD SH=SHP SI=EUR SJ=NOK SK=EUR SL=SLE SM=EUR SN=XOF SO=SOS SR=SRD SS=SSP ST=STN SV=USD SX=XCG SY=SYP SZ=SZL
TC=USD TD=XAF TF=EUR TG=XOF TH=THB TJ=TJS TK=NZD TL=USD TM=TMT TN=TND TO=TOP TR=TRY TT=TTD TV=AUD TW=TWD TZ=TZS
UA=UAH UG=UGX UM=USD US=USD UY=UYU UZ=UZS VA=EUR VC=XCD VE=VES VG=USD VI=USD VN=VND VU=VUV WF=XPF WS=WST YE=YER YT=EUR ZA=ZAR ZM=ZMW ZW=ZWG,USD
`;

export const regionCurrencies: Readonly<Record<string, { primary: string; alternates: readonly string[] }>> = Object.freeze(
  Object.fromEntries(pinnedRegionCurrencies.trim().split(/\s+/u).map((entry) => {
    const [region, values] = entry.split("=");
    const [primary, ...alternates] = values!.split(",");
    return [region!, Object.freeze({ primary: primary!, alternates: Object.freeze(alternates) })];
  })),
);

/** Current actual local currencies; excludes fund units and obsolete ledger-only codes. */
export const destinationCurrencyCodes: ReadonlySet<string> = new Set(
  Object.values(regionCurrencies).flatMap(({ primary, alternates }) => [primary, ...alternates]),
);
