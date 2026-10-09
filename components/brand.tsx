/**
 * Provides the shared DevOnCall identity for authentication and workspaces.
 * The text wordmark follows the parent organization's orange/ink visual style.
 * It is intentionally independent of authentication and role authorization.
 */
import { cn } from "@/lib/utils"
/**
 * Renders the organization wordmark with an optional product descriptor.
 * @param props.className - Layout-specific styling for the brand container.
 * @param props.product - Whether to include the TanovoTime product name.
 * @returns JSX.Element containing the DevOnCall wordmark.
 */
export function Brand({className,product=true}:{className?:string;product?:boolean}) {
  return <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1",className)}>
    <span className="text-xl font-semibold text-primary">DevOnCall<span className="ml-1 text-orange-400" aria-hidden="true">.</span></span>
    {product&&<span className="border-l border-border pl-3 text-sm font-medium text-muted-foreground">TanovoTime</span>}
  </div>
}
