import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";
const mock = vi.hoisted(()=>({locale:undefined as string|undefined}));
vi.mock("next/headers",()=>({cookies:async()=>({get:()=>mock.locale ? {value:mock.locale}:undefined})}));
import RootLayout from "./layout";
describe("initial document language",()=>{
  beforeEach(()=>{mock.locale=undefined;});
  it.each([[undefined,"en"],["ja-JP","ja-JP"],["zh-HK-lihkg","zh-HK"],["es","es"],["invalid","en"]])("renders %s before hydration as %s",async(input,expected)=>{
    mock.locale=input;
    const tree=await RootLayout({children:null});
    expect(isValidElement(tree)).toBe(true);
    expect(tree.props.lang).toBe(expected);
    expect(tree.props["data-ui"]).toBe("new");
  });
});
