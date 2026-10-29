"use client"
import { createContext,useContext,type PointerEvent as ReactPointerEvent,type ReactNode } from "react"

export type AssistantWindowControls={docked:boolean;onToggleDock:()=>void;onDragStart:(event:ReactPointerEvent<HTMLElement>)=>void;onDragMove:(event:ReactPointerEvent<HTMLElement>)=>void;onDragEnd:(event:ReactPointerEvent<HTMLElement>)=>void}
type WindowAssistantRenderer=(workspace:string,onClose:()=>void,onPreferredHeight?:(height:number)=>void,controls?:AssistantWindowControls)=>ReactNode
const WindowAssistantContext=createContext<WindowAssistantRenderer|null>(null)

/** Provides the signed-in application's renderer to independent window surfaces. */
export function WindowAssistantProvider({renderAssistant,children}:{renderAssistant:WindowAssistantRenderer;children:ReactNode}){
  return <WindowAssistantContext.Provider value={renderAssistant}>{children}</WindowAssistantContext.Provider>
}

/** @returns The app-level contextual assistant renderer, or null outside the app shell. */
export function useWindowAssistantRenderer():WindowAssistantRenderer|null{return useContext(WindowAssistantContext)}
