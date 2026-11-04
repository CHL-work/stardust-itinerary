import { readFileSync } from "node:fs";
import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { ItineraryDayMap } from "@/components/app-shell";
import { DayEventMap, type DayEventMapProps } from "@/components/day-event-map";
import { projectDayMapStops } from "@/lib/maps/day-stops";
import { dayMapMessages } from "@/lib/maps/i18n";
import { locales } from "@/lib/i18n";

type Props = ComponentProps<typeof ItineraryDayMap>;
const source = readFileSync("src/components/app-shell.tsx", "utf8");
const ast = ts.createSourceFile("app-shell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function findNodes<T extends ts.Node>(root: ts.Node, predicate: (node: ts.Node) => node is T): T[] {
  const result: T[] = [];
  function visit(node: ts.Node) {
    if (predicate(node)) result.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  return result;
}

function ancestor(node: ts.Node, predicate: (candidate: ts.Node) => boolean): ts.Node | null {
  for (let candidate = node.parent; candidate; candidate = candidate.parent) {
    if (predicate(candidate)) return candidate;
  }
  return null;
}

function fixture(): Props {
  const days = [{ id: "day-a", date: "2030-04-01" }, { id: "day-b", date: "2030-04-02" }];
  return {
    overview: {
      trip: { id: "trip-a", timeZone: "Asia/Tokyo" }, session: { memberId: "member-a" }, days,
      itinerary: [{
        id: "public-event", tripDayId: "day-a", itemType: "activity", title: "Synthetic public stop",
        startsAt: "2030-04-01T01:00:00Z", endsAt: null, status: "planned", visibility: "trip",
        locationName: "Synthetic venue A", mapUrl: null, weather: null,
      }, {
        id: "private-event", tripDayId: "day-a", itemType: "activity", title: "Synthetic private stop",
        startsAt: "2030-04-01T02:00:00Z", endsAt: null, status: "planned", visibility: "private",
        locationName: "Synthetic private venue", mapUrl: null,
      }, {
        id: "next-day-event", tripDayId: "day-b", itemType: "activity", title: "Synthetic next-day stop",
        startsAt: "2030-04-02T01:00:00Z", endsAt: null, status: "planned", visibility: "trip",
        locationName: "Synthetic venue B", mapUrl: null,
      }],
      pendingItinerary: [{
        requestId: "pending-event", operation: "create", targetItemId: null, status: "pending",
        tripDayId: "day-a", itemType: "meal", title: "Synthetic proposed stop",
        startsAt: "2030-04-01T03:00:00Z", endsAt: null, visibility: "trip", locationName: null, mapUrl: null,
      }],
    } as unknown as Props["overview"],
    day: days[0], locale: "en",
  };
}

/** Execute the actual wrapper with an inert memo hook, retaining React's real element/key semantics. */
function wrapper() {
  const declaration = findNodes(ast, ts.isFunctionDeclaration).find((node) => node.name?.text === "ItineraryDayMap");
  expect(declaration, "actual exported map wrapper").toBeDefined();
  const compiled = ts.transpileModule(declaration!.getText(ast).replace(/^export\s+/u, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const project = vi.fn(projectDayMapStops);
  const useMemo = vi.fn((compute: () => unknown) => compute());
  const bindings = { React: { createElement }, useMemo, projectDayMapStops: project, DayEventMap };
  const render = new Function(...Object.keys(bindings), `${compiled}; return ItineraryDayMap;`)(...Object.values(bindings)) as (
    props: Props,
  ) => ReactElement<DayEventMapProps>;
  return { render, project, useMemo };
}

describe("actual Overview and Itinerary day-map wiring", () => {
  it("places maps in the selected Overview day and each Itinerary day, without Calendar props", () => {
    const maps = findNodes(ast, ts.isJsxSelfClosingElement).filter((node) => node.tagName.getText(ast) === "ItineraryDayMap");
    expect(maps).toHaveLength(2);
    const attributes = (node: ts.JsxSelfClosingElement) => Object.fromEntries(node.attributes.properties.map((property) => {
      expect(ts.isJsxAttribute(property), "map inputs must be explicit, not spread Calendar-bearing objects").toBe(true);
      if (!ts.isJsxAttribute(property)) return ["spread", property.getText(ast)];
      return [property.name.getText(ast), property.initializer?.getText(ast)];
    }));
    const overviewMap = maps.find((node) => attributes(node).day === "{selectedOverviewDay}")!;
    const itineraryMap = maps.find((node) => attributes(node).day === "{group}")!;
    expect(attributes(overviewMap)).toEqual({ overview: "{overview}", day: "{selectedOverviewDay}", locale: "{locale}" });
    expect(attributes(itineraryMap)).toEqual({ overview: "{overview}", day: "{group}", locale: "{locale}" });
    const overviewGuard = ancestor(overviewMap, (node) => ts.isConditionalExpression(node) && node.condition.getText(ast) === "selectedOverviewDay");
    expect(overviewGuard).not.toBeNull();
    const todayBranch = ancestor(overviewMap, (node) => ts.isConditionalExpression(node) && node.condition.getText(ast) === 'section === "today"');
    expect(todayBranch && ts.isConditionalExpression(todayBranch) && todayBranch.whenTrue.getText(ast)).toContain(overviewMap.getText(ast));
    const dayGroup = ancestor(itineraryMap, (node) => ts.isCallExpression(node) && node.expression.getText(ast) === "itineraryDayGroups.map");
    expect(dayGroup).not.toBeNull();
    expect(ancestor(itineraryMap, (node) => ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "DayAccordion")).not.toBeNull();
  });

  it("passes only the authorized app projection and exact selected-day context to the component", () => {
    const input = fixture();
    const run = wrapper();
    const element = run.render(input);
    expect(run.project).toHaveBeenCalledExactlyOnceWith({
      itinerary: input.overview.itinerary, pendingItinerary: input.overview.pendingItinerary, days: input.overview.days,
      timeZone: "Asia/Tokyo", tripDayId: "day-a", includePrivate: true,
    });
    expect(element.type).toBe(DayEventMap);
    expect(element.props).toEqual({
      tripId: "trip-a", memberId: "member-a", tripDayId: "day-a", date: "2030-04-01", timeZone: "Asia/Tokyo", locale: "en",
      stops: projectDayMapStops({ itinerary: input.overview.itinerary, pendingItinerary: input.overview.pendingItinerary,
        days: input.overview.days, timeZone: "Asia/Tokyo", tripDayId: "day-a", includePrivate: true }),
    });
    expect(element.props.stops.map((stop) => stop.key)).toEqual(["public-event:event", "private-event:event", "pending:pending-event:event"]);
    expect(element.props.stops[2]).toMatchObject({ pending: true, locationName: null });
  });

  it("never reads or projects raw personal Calendar rows from either shell context", () => {
    const input = fixture();
    const readRawCalendar = vi.fn(() => { throw new Error("Raw Calendar data must not be read by map wiring"); });
    Object.defineProperty(input.overview, "calendar", { get: readRawCalendar });
    Object.defineProperty(input.day, "calendarPoints", { get: readRawCalendar });
    const run = wrapper();
    const element = run.render(input);
    expect(readRawCalendar).not.toHaveBeenCalled();
    expect(Object.keys(run.project.mock.calls[0]![0]).sort()).toEqual([
      "days", "includePrivate", "itinerary", "pendingItinerary", "timeZone", "tripDayId",
    ]);
    expect(Object.keys(element.props).sort()).toEqual(["date", "locale", "memberId", "stops", "timeZone", "tripDayId", "tripId"]);
  });

  it.each(locales)("renders the real map collapsed and provider-free by default in %s", (locale) => {
    const input = { ...fixture(), locale };
    const markup = renderToStaticMarkup(createElement(ItineraryDayMap, input));
    expect(markup).toContain(dayMapMessages(locale).show);
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("Synthetic private");
    expect(markup).not.toContain("Synthetic public");
    expect(markup).not.toContain("<iframe");
    expect(markup).not.toContain("maps.googleapis.com");
  });
});

describe("ItineraryDayMap remount identity", () => {
  const scopeChanges: Array<[string, (props: Props) => void]> = [
    ["trip", (props) => { props.overview.trip.id = "trip-b"; }],
    ["member", (props) => { props.overview.session.memberId = "member-b"; }],
    ["day", (props) => { props.day = props.overview.days[1]; }],
    ["day date", (props) => { props.day = { ...props.day, date: "2030-04-03" }; }],
    ["locale", (props) => { props.locale = "ja-JP"; }],
    ["time zone", (props) => { props.overview.trip.timeZone = "UTC"; }],
    ["event location", (props) => { props.overview.itinerary[0].locationName = "Changed synthetic venue"; }],
    ["event title", (props) => { props.overview.itinerary[0].title = "Changed synthetic title"; }],
    ["event time", (props) => { props.overview.itinerary[0].startsAt = "2030-04-01T01:30:00Z"; }],
    ["event Maps link", (props) => { props.overview.itinerary[0].mapUrl = "https://www.google.com/maps/place/Synthetic"; }],
    ["event audience", (props) => { props.overview.itinerary[0].visibility = "private"; }],
    ["event cancellation", (props) => { props.overview.itinerary[0].status = "cancelled"; }],
    ["pending proposal", (props) => { props.overview.pendingItinerary[0].locationName = "Changed proposed venue"; }],
    ["pending removal", (props) => { props.overview.pendingItinerary = []; }],
  ];

  it.each(scopeChanges)("discards loaded imagery/consent by changing the React key after %s changes", (_, change) => {
    const run = wrapper();
    const original = fixture();
    const changed = structuredClone(original);
    change(changed);
    expect(run.render(changed).key).not.toBe(run.render(original).key);
  });

  it("keeps an open map stable after unrelated refreshes and equivalent array replacement", () => {
    const run = wrapper();
    const original = fixture();
    const changed = structuredClone(original);
    changed.overview.itinerary[0].notes = "Unrelated updated notes";
    changed.overview.itinerary[0].weather = { condition: "Synthetic sunshine" } as Props["overview"]["itinerary"][number]["weather"];
    Object.assign(changed.overview, { expenses: [{ description: "Unrelated synthetic expense" }], aiLogs: [], approvalPendingCount: 5 });
    expect(run.render(changed).key).toBe(run.render(original).key);
  });

  it("keeps another day's event edits out of the selected day's remount identity", () => {
    const run = wrapper();
    const original = fixture();
    const changed = structuredClone(original);
    changed.overview.itinerary[2].locationName = "Changed next-day venue";
    expect(run.render(changed).key).toBe(run.render(original).key);
  });
});
