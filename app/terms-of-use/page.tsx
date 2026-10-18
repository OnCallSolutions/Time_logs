import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { TermsOfUseContent } from "@/components/terms-of-use"

export default function TermsOfUsePage(){
  return <main className="min-h-dvh bg-slate-50 px-4 py-6 text-slate-950 sm:px-8">
    <article className="mx-auto max-w-4xl space-y-5">
      <Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-sky-800 hover:text-sky-950"><ArrowLeft className="size-4"/>Back to Tanovo Time</Link>
      <header className="border-b-2 border-orange-400 bg-white px-4 py-4"><h1 className="text-xl font-semibold">Terms of Use</h1><p className="mt-1 text-sm text-slate-600">Patron responsibilities for authorized access and information handling.</p></header>
      <TermsOfUseContent/>
    </article>
  </main>
}
