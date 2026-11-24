import React from "react";
import { Download } from "lucide-react";

interface BotGuideProps {
  onDownloadZip?: () => void;
  downloadingZip?: boolean;
}

interface CommandDoc {
  command: string;
  aliases: string;
  action: string;
  botReply: string;
}

const COMMANDS: CommandDoc[] = [
  {
    command: "!banat on",
    aliases: "!banat enable · !banat start",
    action:
      "Ina-activate ang Banat auto-reply mode para sa kasalukuyang Messenger thread. Sasagot na ang bot sa bawat incoming message sa chat na iyon hanggang i-off.",
    botReply: "banat is on. say whatever u want 😭"
  },
  {
    command: "!banat off",
    aliases: "!banat disable · !banat stop",
    action:
      "Pinapatay ang tuloy-tuloy na Banat auto-reply mode sa kasalukuyang thread. Hindi na ito sasagot sa lahat ng mensahe maliban kung direktang i-mention o i-replyan.",
    botReply: "banat off. peace 😭"
  },
  {
    command: "!banat toggle",
    aliases: "—",
    action:
      "Mabilisang paglipat ng mode sa thread: kung naka-ON ay gagawing OFF, at kung naka-OFF ay gagawing ON.",
    botReply: "banat is on 😭 / banat is off"
  },
  {
    command: "!banat status",
    aliases: "!banat",
    action:
      "Sinusuri at ipinapakita sa chat kung aktibo (ON) o naka-off (OFF) ang Banat mode sa kasalukuyang thread.",
    botReply: "banat: ON 🟢 / banat: OFF 🔴"
  },
  {
    command: "!banat help",
    aliases: "—",
    action: "Nagpapadala ng maikling listahan ng lahat ng !banat commands sa Messenger chat.",
    botReply: "!banat on · !banat off · !banat toggle · !banat status"
  }
];

const STEPS = [
  {
    step: "01",
    title: "Mag-login sa Facebook sa kabilang browser tab",
    description:
      "Buksan ang Facebook sa hiwalay na tab ng iyong browser at siguraduhing aktibong naka-login ang Facebook account na gagamitin ng bot."
  },
  {
    step: "02",
    title: "I-export ang JSON Cookies",
    description:
      "Gamit ang cookie exporter extension mula sa naka-login na tab, i-export ang cookies sa JSON format (siguraduhing kasama ang c_user at xs cookies)."
  },
  {
    step: "03",
    title: "Ilagay ang Bot Name, Facebook UID, at Cookies",
    description:
      "Sa Controls tab, ilagay ang Bot Name, Facebook UID (awtomatikong nade-detect mula sa c_user kung bakante), at i-upload ang .json file o i-paste ang JSON cookies."
  },
  {
    step: "04",
    title: "I-click ang Start Bot at hintayin ang Online status",
    description:
      "I-click ang Start Bot. Hintaying maging Online (berde) ang status indicator sa itaas—patunay na nakumpirma ng backend ang koneksyon sa Facebook Messenger."
  },
  {
    step: "05",
    title: "Gamitin ang !banat commands sa Messenger",
    description:
      "Sa kahit anong group chat o PM, mag-send ng !banat on para magsimulang sumagot ang bot nang may natural na typing delay at cooldown protection."
  }
];

const TRIGGER_POOLS = [
  {
    group: "bot",
    triggers: "bot, robot, ai",
    count: "17 replies",
    behavior: "Sinasagot kapag nabanggit ang mga salitang tumutukoy sa bot o AI."
  },
  {
    group: "trash-talk",
    triggers: "weak, laro, tanginamo, lala, patawa, gago, bobo, tanga, hahahaa, pake ko, sino yan",
    count: "98 replies",
    behavior: "Nagbibigay ng mapanuksong banat reply kapag may tumugmang trigger word."
  },
  {
    group: "jaiden",
    triggers: "jaiden",
    count: "23 replies",
    behavior: "Dedicated na reply pool kapag nabanggit ang pangalang jaiden."
  }
];

export function BotGuide({ onDownloadZip, downloadingZip = false }: BotGuideProps) {
  return (
    <div className="mt-6 space-y-6">
      {onDownloadZip && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Download Complete Source Code (.zip)
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                I-download ang buong dashboard at bot source code (<code className="font-mono text-xs">bot/</code>, <code className="font-mono text-xs">src/</code>, <code className="font-mono text-xs">server.ts</code>, <code className="font-mono text-xs">package.json</code>) bilang ZIP archive.
              </p>
            </div>
            <button
              type="button"
              onClick={onDownloadZip}
              disabled={downloadingZip}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Download className="h-4 w-4" />
              <span>{downloadingZip ? "Preparing ZIP..." : "Download Source (.zip)"}</span>
            </button>
          </div>
        </section>
      )}

      {/* Step-by-step usage guide */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="border-b border-slate-100 pb-4">
          <h2 className="text-lg font-semibold text-slate-900">
            Paano Gamitin ang Bot
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Sundin ang mga hakbang na ito para makakonekta nang maayos ang Facebook session at gumana ang auto-banat sa Messenger.
          </p>
        </div>

        <ol className="mt-2 divide-y divide-slate-100">
          {STEPS.map((item) => (
            <li key={item.step} className="flex flex-col gap-1.5 py-4 sm:flex-row sm:items-start sm:gap-5">
              <span className="font-mono text-xs font-semibold text-blue-600 tabular-nums shrink-0 sm:pt-0.5">
                Step {item.step}
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900">{item.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{item.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Messenger Commands Reference */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="border-b border-slate-100 pb-4">
          <h2 className="text-lg font-semibold text-slate-900">
            Mga Bot Commands sa Messenger
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            I-type ang mga command na ito direkta sa Messenger chat habang Online at hindi naka-stop ang bot.
          </p>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                <th className="py-2.5 pr-4 whitespace-nowrap">Command</th>
                <th className="py-2.5 pr-4 whitespace-nowrap">Aliases</th>
                <th className="py-2.5 pr-4">Ano ang Ginagawa</th>
                <th className="py-2.5 whitespace-nowrap">Sagot ng Bot</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {COMMANDS.map((cmd) => (
                <tr key={cmd.command} className="align-top hover:bg-slate-50/70">
                  <td className="py-3 pr-4 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                    {cmd.command}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs text-slate-500 whitespace-nowrap">
                    {cmd.aliases}
                  </td>
                  <td className="py-3 pr-4 text-slate-700 leading-relaxed min-w-[240px]">
                    {cmd.action}
                  </td>
                  <td className="py-3 font-mono text-xs text-slate-600 min-w-[180px]">
                    {cmd.botReply}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Auto-Reply & Trigger Behavior */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="border-b border-slate-100 pb-4">
          <h2 className="text-lg font-semibold text-slate-900">
            Paano Sumasagot ang Bot (Targeting &amp; Trigger Pools)
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Bukod sa <code className="font-mono text-xs">!banat on</code>, may built-in targeting at local trigger pools ang bot.
          </p>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
            <h3 className="text-sm font-semibold text-slate-900">Kapag Naka-ON ang Thread</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
              Kapag nag-send ng <code className="font-mono text-xs">!banat on</code>, sasagot ang bot sa bawat mensahe sa thread gamit ang matched trigger reply o random banat pool, na may human-like typing delay at 12-second thread cooldown para iwas spam.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
            <h3 className="text-sm font-semibold text-slate-900">Kapag Naka-OFF ang Thread</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
              Kung hindi pa naka-ON ang thread, sasagot lamang ang bot kapag ni-replyan ang message nito, na-mention ang bot, o tinawag nang direkta gaya ng <code className="font-mono text-xs">bot</code>, <code className="font-mono text-xs">eclipse</code>, <code className="font-mono text-xs">ecl</code>, o <code className="font-mono text-xs">hev</code>.
            </p>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                <th className="py-2.5 pr-4 whitespace-nowrap">Trigger Group</th>
                <th className="py-2.5 pr-4">Trigger Words</th>
                <th className="py-2.5 pr-4 whitespace-nowrap">Pool Size</th>
                <th className="py-2.5">Deskripsyon</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {TRIGGER_POOLS.map((pool) => (
                <tr key={pool.group} className="align-top hover:bg-slate-50/70">
                  <td className="py-3 pr-4 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                    {pool.group}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs text-slate-700 min-w-[200px]">
                    {pool.triggers}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs text-slate-600 whitespace-nowrap tabular-nums">
                    {pool.count}
                  </td>
                  <td className="py-3 text-slate-600 min-w-[220px]">{pool.behavior}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
