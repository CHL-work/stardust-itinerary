import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DestinationLookupResponse } from "@/lib/app/trip-destination-contract";
import type { Locale } from "@/lib/i18n";
import { getTripCreationOptions } from "@/lib/app/trip-creation-options";

// Exercise the actual event handlers with a minimal hook host, without a browser or real account.
const host = vi.hoisted(() => ({values:[] as unknown[],cursor:0}));
vi.mock("react",async (original) => ({...await original<typeof import("react")>(),
  useState:(initial:unknown) => {
    const slot = host.cursor++;
    if (!(slot in host.values)) host.values[slot] = typeof initial === "function" ? initial() : initial;
    return [host.values[slot],(value:unknown) => { host.values[slot] = typeof value === "function" ? value(host.values[slot]) : value; }];
  },
  useRef:(initial:unknown) => {
    const slot = host.cursor++;
    if (!(slot in host.values)) host.values[slot] = {current:initial};
    return host.values[slot];
  },
  useEffect:vi.fn(),
}));
const router = vi.hoisted(() => ({push:vi.fn(),refresh:vi.fn(),replace:vi.fn()}));
vi.mock("next/navigation",() => ({useRouter:() => router}));
import { CreateTripForm, createTripCopy } from "./create-trip-form";

type Node = ReactElement<Record<string, unknown>>;
function descendants(node:ReactNode):Node[] {
  if (Array.isArray(node)) return node.flatMap(descendants);
  return isValidElement<Record<string,unknown>>(node) ? [node,...descendants(node.props.children as ReactNode)] : [];
}
// The page sends one language's copy and choices; another language arrives as new props once the page reloads (JOB-085).
let page:{locale:Locale;options:ReturnType<typeof getTripCreationOptions>} = {locale:"en",options:getTripCreationOptions("en")};
const props = {now:"2030-01-01T00:00:00Z",authenticated:true,signupEnabled:false,lookupEntitled:true};
const fetchMock = vi.fn();
function render(lookupEntitled = true) {host.cursor = 0; return descendants(CreateTripForm({...props,...page,lookupEntitled}));}
function control(name:string) {return render().find((node) => node.props.name === name)!;}
function change(name:string,value:string) {(control(name).props.onChange as (event:unknown) => void)({target:{value}});}
function blur() {(control("destinationName").props.onBlur as () => void)();}
function enter() {
  const preventDefault = vi.fn();
  (control("destinationName").props.onKeyDown as (event:unknown) => void)({key:"Enter",preventDefault});
  return preventDefault;
}
const base:Omit<DestinationLookupResponse,"requestId"> = {status:"resolved",reason:null,countryCode:"JP",countryLabels:null,
  timeZone:"Asia/Tokyo",timeZoneCandidates:[],countryTimeZones:["Asia/Tokyo"],currency:"JPY",currencyCandidates:["JPY"],unsupportedLocalCurrency:null,
  lookupId:"00000000-0000-4000-8000-000000000001",source:"ai"};
function reply(index = 0, result:Partial<typeof base> = {}) {
  const request = JSON.parse(fetchMock.mock.calls[index][1].body);
  return Response.json({...base,...result,requestId:request.requestId});
}
async function flush() {await new Promise((resolve) => setTimeout(resolve,0));}

describe("trip creation destination interactions",() => {
  beforeEach(() => {
    host.values = []; host.cursor = 0; fetchMock.mockReset(); vi.stubGlobal("fetch",fetchMock);
    page = {locale:"en",options:getTripCreationOptions("en")}; router.replace.mockReset();
    vi.stubGlobal("window",{setTimeout,clearTimeout,requestAnimationFrame:vi.fn()});
  });
  afterEach(() => vi.unstubAllGlobals());
  it("never calls AI on mount, typing or manual edits; saves language before switching",async () => {
    fetchMock.mockResolvedValue(Response.json({locale:"ja-JP"}));
    render(); change("destinationName","Dall"); change("destinationName","Dallas");
    change("timeZone","America/Chicago"); change("defaultCurrency","USD");
    const language = render().find((node) => node.type === "select" && node.props["aria-label"] === "Language")!;
    (language.props.onChange as (event:unknown) => void)({target:{value:"ja-JP"}});
    expect(router.replace).not.toHaveBeenCalled();
    await flush();
    expect(router.replace).toHaveBeenCalledWith("/trips/new?locale=ja-JP",{scroll:false});
    render(); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/account/locale");
  });
  it("keeps the selected language and form when saving the preference fails",async () => {
    fetchMock.mockResolvedValue(Response.json({}, {status:401}));
    const language = render().find((node) => node.type === "select" && node.props["aria-label"] === "Language")!;
    (language.props.onChange as (event:unknown) => void)({target:{value:"ja-JP"}});
    await flush();
    expect(router.replace).not.toHaveBeenCalled();
    expect(render().some((node) => node.props.role === "alert" && node.props.children === "Could not save the language. Try again.")).toBe(true);
  });
  it("Enter commits an AI lookup for Japan without submitting or starting twice on blur",async () => {
    let finish!:(response:Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => {finish = resolve;}));
    expect(enter()).toHaveBeenCalledOnce(); blur();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/trips/destination-defaults");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).destination).toBe("Japan");
    finish(reply()); await flush();
    expect(control("timeZone").props.value).toBe("Asia/Tokyo");
    expect(render().find((node) => node.props.type === "submit")?.props["aria-disabled"]).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("a late reply cannot replace a destination typed before the next blur",async () => {
    let finish!:(response:Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => {finish = resolve;}));
    blur(); change("destinationName","Dallas"); finish(reply()); await flush();
    expect(control("timeZone").props.value).toBe("");
    expect(control("defaultCurrency").props.value).toBe("");
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it("manual choices during lookup survive its response and remain submittable",async () => {
    let finish!:(response:Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => {finish = resolve;}));
    blur(); change("timeZone","America/Chicago"); change("defaultCurrency","USD");
    expect(render().find((node) => node.props.type === "submit")?.props["aria-disabled"]).toBe(false);
    finish(reply()); await flush();
    expect(control("timeZone").props.value).toBe("America/Chicago");
    expect(control("defaultCurrency").props.value).toBe("USD");
    expect(render().some((node) => node.props.children === "Use JPY (suggested)")).toBe(true);
  });
  it("opens localized manual fallback and never renders raw provider prose",async () => {
    fetchMock.mockImplementation(() => Promise.resolve(Response.json({error:"PRIVATE_UPSTREAM_ERROR"},{status:502})));
    blur(); await flush();
    const nodes = render();
    expect(nodes.find((node) => node.type === "details")?.props.open).toBe(true);
    expect(nodes.some((node) => node.props.children === createTripCopy("en").lookupUnavailable)).toBe(true);
    expect(nodes.some((node) => node.props.children === "PRIVATE_UPSTREAM_ERROR")).toBe(false);
    expect(control("timeZone").props.value).toBe("");
  });
  it("does not call AI for an unentitled principal",() => {
    const destination = render(false).find((node) => node.props.name === "destinationName")!;
    (destination.props.onBlur as () => void)(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("handles locale changes during lookup using the latest display language",async () => {
    let finish!:(response:Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => {finish = resolve;}));
    blur();
    fetchMock.mockResolvedValueOnce(Response.json({locale:"ja-JP"}));
    const language = render().find((node) => node.type === "select" && node.props["aria-label"] === "Language")!;
    (language.props.onChange as (event:unknown) => void)({target:{value:"ja-JP"}});
    await flush();
    // Until the page reloads in Japanese, the select shows the choice and the form cannot be sent.
    const pending = render();
    expect(pending.find((node) => node.type === "select" && node.props["aria-label"] === "Language")!.props.value).toBe("ja-JP");
    expect(pending.find((node) => node.type === "button" && node.props.type === "submit")!.props["aria-disabled"]).toBe(true);
    page = {locale:"ja-JP",options:getTripCreationOptions("ja-JP")};
    finish(reply()); await flush();
    const status = render().find((node) => node.props.role === "status")!;
    expect(status.props.children).toContain("タイムゾーン"); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("restores the validated automatic zone when Auto is chosen again",async () => {
    fetchMock.mockImplementation(() => Promise.resolve(reply()));
    blur(); await flush(); change("timeZone","America/Chicago"); change("timeZone","");
    expect(control("timeZone").props.value).toBe("Asia/Tokyo"); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("explains even a single alternate currency",async () => {
    fetchMock.mockImplementation(() => Promise.resolve(reply(0,{currency:"MOP",currencyCandidates:["HKD"]})));
    blur(); await flush();
    expect(render().some((node) => Array.isArray(node.props.children) && node.props.children.includes(createTripCopy("en").currencyMultiple))).toBe(true);
  });
  it.each([401,403])("explains sign-in status %i instead of a provider outage",async (status) => {
    fetchMock.mockResolvedValue(Response.json({error:"Do not display raw error"},{status}));
    blur(); await flush();
    const message = render().find((node) => node.props.role === "status")!;
    expect(message.props.children).toBe(createTripCopy("en")[status === 401 ? "auth" : "forbidden"]);
  });
});
