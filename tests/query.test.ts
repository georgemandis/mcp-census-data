import { createCensusClient } from "../src/core/client.js";
import { datasetPath, isTimeseries, queryData } from "../src/core/query.js";
import { clientReturning, fake, recordingClient } from "./helpers.js";

test("vintage datasets put the year first", () =>
  expect(datasetPath("acs/acs5", 2024)).toBe("2024/acs/acs5"));

test("timeseries datasets have no year in the path", () => {
  expect(isTimeseries("timeseries/poverty/saipe")).toBe(true);
  expect(datasetPath("timeseries/poverty/saipe")).toBe("timeseries/poverty/saipe");
});

test("a vintage passed with a timeseries dataset is ignored", () =>
  expect(datasetPath("timeseries/poverty/saipe", 2022)).toBe("timeseries/poverty/saipe"));

test("a vintage dataset without a vintage is an invalid_request", () => {
  expect(() => datasetPath("acs/acs5")).toThrowError(
    expect.objectContaining({
      kind: "invalid_request",
      message:
        "Dataset acs/acs5 needs a vintage (year). Use discover_datasets to see available years.",
    })
  );
});

test("more than 50 variables is rejected before any request", async () => {
  const f = recordingClient();
  const get = Array.from({ length: 51 }, (_, i) => `V${i}`);
  await expect(
    queryData(f.client, { dataset: "acs/acs5", vintage: 2024, get, for: "us:1" })
  ).rejects.toMatchObject({
    kind: "invalid_request",
    message:
      "The Census API accepts at most 50 variables per query; got 51. Split the request.",
  });
  expect(f.paths).toEqual([]);
});

test("data queries need a key", async () => {
  const c = createCensusClient({ apiKey: "", fetch: fake([]) });
  await expect(
    queryData(c, { dataset: "acs/acs5", vintage: 2024, get: ["NAME"], for: "us:1" })
  ).rejects.toMatchObject({ kind: "missing_key" });
});

test("the header row becomes object keys", async () => {
  const r = await queryData(
    clientReturning([
      ["NAME", "B01003_001E", "state"],
      ["Washington", "7700000", "53"],
    ]),
    { dataset: "acs/acs5", vintage: 2024, get: ["NAME", "B01003_001E"], for: "state:53" }
  );
  expect(r).toEqual({
    rows: [{ NAME: "Washington", B01003_001E: "7700000", state: "53" }],
    total: 1,
    truncated: false,
    nullsReplaced: 0,
  });
});

test("in and predicates are added to the request", async () => {
  const f = recordingClient();
  await queryData(f.client, {
    dataset: "timeseries/poverty/saipe",
    get: ["NAME", "SAEPOVRTALL_PT"],
    for: "county:*",
    in: "state:53",
    predicates: { time: "2022" },
  });
  expect(f.paths[0]).toBe(
    "timeseries/poverty/saipe?get=NAME%2CSAEPOVRTALL_PT&for=county%3A*&in=state%3A53&time=2022"
  );
});

test("rows past the default limit of 500 are dropped and counted", async () => {
  const rows = Array.from({ length: 600 }, (_, i) => [`Place ${i}`]);
  const r = await queryData(clientReturning([["NAME"], ...rows]), {
    dataset: "acs/acs5", vintage: 2024, get: ["NAME"], for: "county:*",
  });
  expect(r.rows.length).toBe(500);
  expect(r.total).toBe(600);
  expect(r.truncated).toBe(true);
});

test("limit is honoured and capped at 5000", async () => {
  const rows = Array.from({ length: 6000 }, (_, i) => [`Place ${i}`]);
  const c = clientReturning([["NAME"], ...rows]);
  const q = { dataset: "acs/acs5", vintage: 2024, get: ["NAME"], for: "tract:*" };
  expect((await queryData(c, { ...q, limit: 10 })).rows.length).toBe(10);
  expect((await queryData(c, { ...q, limit: 99999 })).rows.length).toBe(5000);
});

test("sentinel values become null", async () => {
  const r = await queryData(
    clientReturning([
      ["NAME", "B19013_001E"],
      ["Tract 1", "-666666666"],
      ["Tract 2", "52000"],
    ]),
    { dataset: "acs/acs5", vintage: 2024, get: ["NAME", "B19013_001E"], for: "tract:*", in: "state:53 county:033" }
  );
  expect(r.rows[0].B19013_001E).toBeNull();
  expect(r.rows[1].B19013_001E).toBe("52000");
  expect(r.nullsReplaced).toBe(1);
});

test("sloppy identifiers are normalised", async () => {
  const f = recordingClient();
  await queryData(f.client, {
    dataset: " ACS/acs5 ", vintage: 2024, get: ["name", " b19013_001e"], for: "state: 06",
  });
  expect(f.paths[0]).toBe("2024/acs/acs5?get=NAME%2CB19013_001E&for=state%3A06");
});

test("an empty 204 response is an empty result", async () => {
  const r = await queryData(clientReturning(null), {
    dataset: "acs/acs5", vintage: 2024, get: ["NAME"], for: "us:1",
  });
  expect(r).toEqual({ rows: [], total: 0, truncated: false, nullsReplaced: 0 });
});

test("a response that is not a table is a bad_response", async () => {
  await expect(
    queryData(clientReturning({ error: "nope" }), {
      dataset: "acs/acs5", vintage: 2024, get: ["NAME"], for: "us:1",
    })
  ).rejects.toMatchObject({ kind: "bad_response" });
});

test("spaces inside level names and between clauses survive", async () => {
  const f = recordingClient();
  await queryData(f.client, {
    dataset: "acs/acs5", vintage: 2024, get: ["NAME"],
    for: "block group : *", in: "state:53  county: 033",
  });
  expect(f.paths[0]).toBe(
    "2024/acs/acs5?get=NAME&for=block+group%3A*&in=state%3A53+county%3A033"
  );
});

// --- Final review fixes ---

test("lower-case variable names that are not table codes keep their case", async () => {
  const f = recordingClient();
  await queryData(f.client, {
    dataset: "timeseries/eits/advm3",
    get: ["cell_value", "data_type_code", "time_slot_id", "b19013_001e", "name", "geo_id"],
    for: "us:*",
  });
  expect(f.paths[0]).toBe(
    "timeseries/eits/advm3?get=cell_value%2Cdata_type_code%2Ctime_slot_id%2CB19013_001E%2CNAME%2CGEO_ID&for=us%3A*"
  );
});

test("sentinels written as decimals also become null", async () => {
  const r = await queryData(
    clientReturning([["NAME", "A", "B"], ["Tract 1", "-666666666.0", "-999999999.00"]]),
    { dataset: "acs/acs5", vintage: 2024, get: ["NAME", "A", "B"], for: "tract:*" }
  );
  expect(r.rows[0]).toEqual({ NAME: "Tract 1", A: null, B: null });
  expect(r.nullsReplaced).toBe(2);
});

test.each(["get", "for", "in", "key", "KEY"])("predicate '%s' is refused", async (name) => {
  const f = recordingClient();
  await expect(
    queryData(f.client, {
      dataset: "acs/acs5", vintage: 2024, get: ["NAME"], for: "us:1", predicates: { [name]: "x" },
    })
  ).rejects.toMatchObject({
    kind: "invalid_request",
    message: `'${name}' cannot be used as a predicate; it has its own argument.`,
  });
  expect(f.paths).toEqual([]);
});

test.each(["acs/acs5/../acs1", "../../data/2023/acs/acs5?x=", "acs//acs5", "acs/acs5#x", ""])(
  "dataset id %j is refused",
  (id) => {
    expect(() => datasetPath(id, 2024)).toThrowError(
      expect.objectContaining({ kind: "invalid_request" })
    );
  }
);

test("a 404 on a data query says the dataset or year was not found", async () => {
  const c = createCensusClient({ apiKey: "K", fetch: fake([new Response("<!doctype html><html>Tomcat 404</html>", { status: 404 })]) });
  const err = await queryData(c, { dataset: "acs/acs5", vintage: 2031, get: ["NAME"], for: "us:1" }).catch((e) => e);
  expect(err).toMatchObject({ kind: "invalid_request" });
  expect(err.message).toContain("Dataset acs/acs5 for 2031 was not found");
  expect(err.message).not.toContain("Tomcat");
});
