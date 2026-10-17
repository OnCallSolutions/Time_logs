"use client"
import { createContext,useContext,type ReactNode } from "react"

type WindowAssistantRenderer=(workspace:string,onClose:()=>void,onPreferredHeight?:(height:number)=>void)=>ReactNode
const WindowAssistantContext=createContext<WindowAssistantRenderer|null>(null)

/** Provides the signed-in application's renderer to independent window surfaces. */
export function WindowAssistantProvider({renderAssistant,children}:{renderAssistant:WindowAssistantRenderer;children:ReactNode}){
  return <WindowAssistantContext.Provider value={renderAssistant}>{children}</WindowAssistantContext.Provider>
}

/** @returns The app-level contextual assistant renderer, or null outside the app shell. */
export function useWindowAssistantRenderer():WindowAssistantRenderer|null{return useContext(WindowAssistantContext)}
