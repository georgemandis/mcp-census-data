# Census Bureau API: Complete Dataset Inventory

Generated 2026-04-16 from https://api.census.gov/data.json

**1,776 dataset-vintage combinations** across **~150 unique endpoints**.

---

## The Big Three (most-used, most valuable)

| Program | Endpoint | What it has | Years | Geographies |
|---|---|---|---|---|
| **ACS 1-Year** | `acs/acs1` | The motherlode. Demographics, income, education, housing, languages, commuting, insurance, ancestry, disability — hundreds of tables. | 2004–2024 | Nation → county, place, tract |
| **ACS 5-Year** | `acs/acs5` | Same as ACS 1-Year but averaged over 5 years — available for smaller geographies. | 2009–2024 | Nation → block group |
| **Decennial Census** | `dec/*` | The once-a-decade full count. Population, race, age, housing. 54 sub-endpoints for 2000/2010/2020. | 2000–2020 | Everything down to block |

## Population & Demographics

| Program | Endpoint | What it has | Years |
|---|---|---|---|
| **Population Estimates (PEP)** | `pep/*` | Annual population estimates between censuses. Age, sex, race, components of change. 38 sub-endpoints. | 1990–2023 |
| **Population Projections** | `popproj/*` | Future population projections — births, deaths, migration. | 2012–2017 |
| **Surnames** | `surname` | Frequency of surnames by race/ethnicity. | 2000, 2010 |
| **Community Resilience** | `cre`, `crepuertorico` | Risk/resilience indices at tract level. | 2019–2024 |

## Jobs, Income & Work

| Program | Endpoint | What it has | Years |
|---|---|---|---|
| **CPS Basic Monthly** | `cps/basic/*` | Employment, unemployment, labor force — monthly. The jobs report data. | 1989–2026 |
| **CPS ASEC (March Supplement)** | `cps/asec/mar` | Income, poverty, health insurance, work experience — the annual deep dive. | 2014+ |
| **County Business Patterns** | `cbp` | Establishments, employment, payroll by industry at county level. | 1986–2023 |
| **Zip Code Business Patterns** | `zbp` | Same as CBP but at zip code level. | 1994–2018 |
| **Nonemployer Statistics** | `nonemp` | Businesses with no paid employees (freelancers, sole proprietors). | 1997–2023 |
| **QWI (Quarterly Workforce)** | `timeseries/qwi` | Workforce dynamics — hires, separations, earnings by demographics. | Time series |

## Business & Economy

| Program | Endpoint | What it has | Years |
|---|---|---|---|
| **Economic Census** | `ecnbasic` + 40+ `ecn*` endpoints | The full economic census — every 5 years. Revenue, payroll, establishments by industry. Dozens of subject-series sub-datasets (food service types, hotel properties, petroleum storage, e-commerce, etc.) | 2012–2022 |
| **Annual Business Survey** | `abscb`, `abscbo`, `abscs`, `absmcb` | Business characteristics, owner demographics, technology use. | 2017–2023 |
| **Annual Survey of Entrepreneurs** | `ase/*` | Business owner characteristics, access to capital. | 2014–2016 |
| **Survey of Business Owners** | `sbo/*` | Older version of business demographics data. | 2012 |
| **Commodity Flow Survey** | `cfsarea`, `cfsexport`, `cfshazmat`, `cfstemp`, `cfspum/*` | How goods move across the US — origins, destinations, modes, hazmat. | 2012–2022 |
| **Annual Integrated Economic Survey** | `timeseries/aies` | Newer unified economic survey replacing several older ones. | Time series |
| **Annual Survey of Manufactures** | `timeseries/asm` | Manufacturing-specific stats (output, shipments, inventories). | Time series |

## Trade & International

| Program | Endpoint | What it has | Years |
|---|---|---|---|
| **International Trade** | `timeseries/intltrade/*` | Monthly imports/exports by commodity, country, port, district. 36 sub-endpoints. | Time series |
| **Historical Imports/Exports** | `intltrade/imp_exp` | Older import/export snapshots. | 2014–2018 |
| **International Database** | `timeseries/idb` | Population data for *other countries*. | Time series |

## Lifestyle, Society & Culture

| Program | Endpoint | What it has | Years |
|---|---|---|---|
| **CPS: School Enrollment** | `cps/school/oct` | Who's enrolled in school, at what level. | 31 vintages |
| **CPS: Food Security** | `cps/foodsec/dec` | Household food insecurity. | 30 vintages |
| **CPS: Internet/Computer Use** | `cps/internet/nov` | Computer and internet access and usage patterns. | 17 vintages |
| **CPS: Tobacco Use** | `cps/tobacco/*` | Smoking and tobacco use patterns. | 15 vintages |
| **CPS: Voting** | `cps/voting` | Voter registration and turnout by demographics. | 16 vintages |
| **CPS: Volunteering** | `cps/volunteer/sep` | Volunteering and civic participation. | 17 vintages |
| **CPS: Veterans** | `cps/vets/aug` | Veteran status and characteristics. | 23 vintages |
| **CPS: Arts/Culture** | `cps/arts`, `cps/pubarts` | Arts participation, public arts engagement. | 10 vintages |
| **CPS: Fertility** | `cps/fertility` | Fertility and birth expectations. | 14 vintages |
| **CPS: Unbanked** | `cps/unbank/jun` | Households without bank accounts. | 8 vintages |
| **Languages** | `language` | Detailed languages spoken at home in the US. | 2013 |
| **Household Pulse Survey** | `timeseries/hps`, `timeseries/hhpulse` | COVID-era rapid survey — anxiety, food, housing, employment. | Time series |
| **Vehicle Inventory** | `vius*` | What vehicles are on the road, how they're used. | 2021 |

## Housing & Finance

| Program | Endpoint | What it has | Years |
|---|---|---|---|
| **Rental Housing Finance** | `rhfs` | Rental property financials, ownership structures. | 2015–2024 |
| **Survey of Market Absorption** | `timeseries/soma` | How fast new apartments get rented/sold. | Time series |
| **Small Area Income/Poverty** | `timeseries/poverty` | Poverty estimates at county/school-district level. | Time series |
| **Small Area Health Insurance** | `timeseries/healthins` | Health insurance coverage at county level. | Time series |

## Government & Education

| Program | Endpoint | What it has | Years |
|---|---|---|---|
| **Public Sector Surveys** | `timeseries/govs`, `timeseries/govsstatefin`, `timeseries/govsemp` | Government finance, employment, payroll. | Time series |
| **Public School Finance** | `pubschlfin` | School district-level revenue and expenditure. | 2012 |
| **Post-Secondary Employment** | `timeseries/pseo` | What graduates earn after college, by school and field. | Time series |
| **Planning Database** | `pdb/*` | Census tract/block-group level variables useful for outreach planning. | 2015–2024 |

## Geography & Reference

| Program | Endpoint | What it has | Years |
|---|---|---|---|
| **Geography Info** | `geoinfo` | FIPS codes, geographic entity metadata. | 2020–2024 |
| **Business Dynamics** | `timeseries/bds` | Firm age, size, job creation/destruction time series. | Time series |
| **Economic Indicators** | `timeseries/eits` | Durable goods, construction spending, retail sales — the headline economic numbers. 21 sub-endpoints. | Time series |

## All Economic Census Sub-Datasets (ecn*)

These are the ~40 specialized slices of the Economic Census:

| Endpoint | Subject |
|---|---|
| `ecnbasic` | Summary statistics by industry |
| `ecnsize` | Data by establishment size |
| `ecncomp` | Comparative statistics across years |
| `ecnbridge1`, `ecnbridge2` | Industry bridge tables (NAICS revision crosswalks) |
| `ecnnapcsind` | Industry by products |
| `ecnnapcsprd` | Products by industry (what we built first) |
| `ecnclcust` | Class of customer |
| `ecnentsup` | Enterprise support |
| `ecnfran` | Franchise status |
| `ecnfoodsvc` | Food service type (restaurant vs. cafeteria vs. catering) |
| `ecnhotel` | Hotel property type |
| `ecnelmenu` | Electronic menu use |
| `ecnseat` | Restaurant seating capacity |
| `ecnmealcost` | Average meal cost |
| `ecnmenutype` | Menu type |
| `ecnguest`, `ecnguestsize` | Hotel guestrooms |
| `ecnconcess` | Concession operations |
| `ecnflspace` | Retail floor space |
| `ecnhosp` | Hospital ownership |
| `ecnpatient` | Patient revenue sources |
| `ecnsocial` | Social assistance revenue |
| `ecngrant` | Grants and transfers |
| `ecnlabor` | Labor services |
| `ecncashadv` | Cash advance services |
| `ecnloan` | Loan types |
| `ecnccard` | Credit card services |
| `ecnadmben` | Admin expenses and benefits |
| `ecnbrordeal`, `ecnbranddeal` | Brokering/dealing services |
| `ecncrfin` | Credit financing types |
| `ecndirprem` | Direct insurance premiums |
| `ecnadbnprop` | Insurance admin and losses |
| `ecncomm` | Wholesale commissions |
| `ecnmargin` | Wholesale gross margin |
| `ecnprofit` | Wholesale gross profit |
| `ecneoyinv`, `ecneoyinvwh` | End-of-year inventories |
| `ecnempfunc` | Employment by function |
| `ecntypop` | Type of wholesale operation |
| `ecnpetrfac/prod/rec/stat` | Petroleum bulk storage |
| `ecninvval` | Inventory valuation methods |
| `ecnlifomfg`, `ecnlifomine`, `ecnlifoval` | LIFO inventory methods |
| `ecnlocmfg`, `ecnlocmine`, `ecnloccons` | Location by employment size |
| `ecnmatfuel` | Mining materials and fuel |
| `ecnkob` | Construction kind-of-business |
| `ecnconact` | Construction activity |
| `ecnvalcon` | Value of construction work |
| `ecnpurelec` | Utility electricity costs |
| `ecnpurgas` | Utility natural gas costs |
| `ecnpurmode` | Transportation purchased costs |
| `ecnequip` | Revenue-generating equipment |
| `ecnrdofc`, `ecnrdacq` | R&D offices and acquisitions |
| `ecnexpsvc` | Exported services |
| `ecnexpnrg` | Exported energy |
| `ecnexpbyaux` | Enterprise support establishments |
| `ecnecomm` | E-commerce statistics |
| `ecngrmargprof` | Wholesale gross margin and profit |
| `ecnipa` | Industry product data |
| `ecnlines` | Lines of business |
| `ecninstr` | Educational instruction modes |
| `ecntypepayer` | Healthcare payer types |
| `ecn/islandareas` | Island areas economic census |
| `ewks` | Economy-wide key statistics |

## All CPS Supplements

| Endpoint | Subject | Vintages |
|---|---|---|
| `cps/basic/*` | Basic monthly employment | 446 (monthly 1989–2026) |
| `cps/asec/mar` | Annual income, poverty, insurance | 34 |
| `cps/school/oct` | School enrollment | 31 |
| `cps/foodsec/dec` | Food security | 30 |
| `cps/vets/aug` | Veterans | 23 |
| `cps/volunteer/sep` | Volunteering & civic life | 17 |
| `cps/internet/nov` | Computer & internet use | 17 |
| `cps/voting` | Voter registration & turnout | 16 |
| `cps/tobacco/*` | Tobacco use | 15 |
| `cps/dwjt/jan` | Displaced workers, tenure, mobility | 15 |
| `cps/fertility` | Fertility | 14 |
| `cps/unbank/jun` | Unbanked households | 8 |
| `cps/contworker` | Contingent workers | 6 |
| `cps/arts` | Arts benchmarking | 6 |
| `cps/civic` | Civic engagement | 5 |
| `cps/pubarts` | Public arts participation | 4 |
| `cps/worksched` | Work schedules | 3 |
| `cps/disability/*` | Disability | 3 |
| `cps/race` | Race & ethnicity | 1 |
| `cps/marital` | Fertility & marital history | 1 |
| `cps/immigration` | Immigration/emigration | 1 |
| `cps/library` | Library use | 1 |

---

## Key Architectural Insight

All endpoints follow the same query pattern:

```
https://api.census.gov/data/{year}/{dataset}?get={variables}&for={geography}&{predicates}
```

Each endpoint has its own:
- `/variables.json` — variable dictionary
- `/geography.json` — supported geographies
- `/groups.json` — variable groupings (tables)
- `/examples.html` — example queries

This means a generic MCP server could query *any* endpoint with the same code — the hard part is **discovery** (finding the right endpoint + variables), not querying.
