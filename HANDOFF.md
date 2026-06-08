# Hand-off — Plugin OpenClaw « Plugin Network »

> Document autonome pour reprendre le projet dans une autre instance sans contexte préalable.
> Version **corrigée** (audit intégré). Les points incertains/non vérifiés sont signalés explicitement.

---

## 1. Objectif

Créer un **plugin OpenClaw** qui visualise, sous forme de **graphe type réseau de neurones**, l'usage des
**plugins / outils / skills** sur une **fenêtre de 30 jours** : ce qui sert, ce qui ne sert à rien, et les
**co-occurrences** (quels nœuds sont mobilisés ensemble dans un même « tour »). OpenClaw est auto-hébergé sur
un **VPS en Docker**. Le viewer se consulte depuis un PC Windows via **tunnel SSH**.

---

## 2. Environnement (faits vérifiés)

- **OpenClaw 2026.6.1**, auto-hébergé, Docker Compose. Backend modèle : **openai-codex / gpt-5.5**.
- **VPS** : IP `116.203.102.30`, user `openclaw`, host `openclaw-tristanb`. Compose dans `~/openclaw/docker-compose.yml`.
- **2 services Docker** :
  - `openclaw-gateway` : process long, **charge les plugins** et exécute l'outil → sert le viewer.
  - `openclaw-cli` : éphémère (`docker compose run`), exécute `openclaw plugins install/uninstall` → **clone le plugin**.
- **Volume** : hôte `~/.openclaw` (= `/home/openclaw/.openclaw`) monté sur conteneur `/home/node/.openclaw`. User conteneur : `node` (HOME=/home/node).
- **Repo GitHub** : `github.com/TristanBqn/neuronal_skills` (public), branche `main`, **fichiers du plugin à la racine du repo**.
- **Dossier dev local** (Windows, iCloud) : `C:\Users\33646\iCloudDrive\OpenClaw\Réseau Neuronal - suivi CLAUDE\plugin`
  — dépôt git initialisé, `origin` configuré, identifiants GitHub **en cache** (push direct fonctionne *tant que le cache persiste*).

---

## 3. Architecture du plugin (fichiers à la racine du repo)

| Fichier | Rôle |
|---|---|
| `package.json` | `"type":"module"`, `openclaw.extensions:["./index.js"]`, `compat.pluginApi:">=2026.5.0"`, script `build` (npx tsc) |
| `openclaw.plugin.json` | Manifeste : id `plugin-network`, outil `plugin_network_open`, `onStartup:false`, `onDemand:true`, configSchema |
| `index.ts` / **`index.js`** | Entrée (`definePluginEntry`) : enregistre l'outil, lit la config, appelle `generateSnapshot` + `ensureViewerServer` |
| `src/aggregate.ts` / **`.js`** | Cœur : lit les trajectoires JSONL, groupe outils + skills, construit nœuds/liens, écrit `data.json` |
| `src/server.ts` / **`.js`** | Serveur HTTP statique singleton pour le viewer, auto-arrêt sur inactivité |
| `src/registry.ts` / `.js` | **ORPHELIN** (plus importé ; ancien lecteur de registre via CLI). **Committé dans le repo**, inoffensif. À supprimer au ménage. |
| `tsconfig.json` | Compile TS→JS **en place** (NodeNext, `noEmitOnError:false`) |
| `viewer/` | `index.html`, `app.jsx`, `network.jsx`, `tweaks-panel.jsx`, `styles.css`, `data.fallback.js` (démo), `data.json` (runtime, **gitignoré**) |
| `.gitignore` | `node_modules/`, `viewer/data.json`, `*.log`, `.DS_Store`, `new_front_end/` |

**Important** : l'install via `git:` exige du **JS compilé** ; c'est pourquoi `extensions` pointe sur `./index.js`
et que les `.js` sont committés. Recompiler après toute modif `.ts` : `npx -y -p typescript@latest tsc -p tsconfig.json`.

**Config du plugin** (`openclaw.plugin.json` → `configSchema`) :
`windowDays` (30), `sessionsDir` (~/.openclaw/agents), `includeGroups` (`["bash","cron","message","memory"]`),
`port` (8742), `bindHost` (`0.0.0.0`), `idleShutdownMinutes` (30).

---

## 4. Source de données (LE point central)

- **Pas de knostic.** L'hypothèse initiale (dépendre de `@knostic/openclaw-telemetry`) était **fausse** : non installé, aucun `telemetry.jsonl`.
- **Source réelle native** : `~/.openclaw/agents/*/sessions/*.trajectory.jsonl`. Format par ligne :
  ```json
  {"type":"tool.call","ts":"2026-06-03T10:57:28.128Z","sessionKey":"agent:main:tui-...",
   "data":{"turnId":"019e...","name":"bash","arguments":{...}}}
  ```
- Champs utilisés : `type==="tool.call"`, `data.name` (outil), **`data.turnId`** (tour natif → co-occurrence exacte), `ts` (fenêtre 30j).
- Types d'événements existants : `session.started`, `context.compiled`, `prompt.submitted`, `model.completed`,
  `tool.call`, `tool.result`, `session.ended`, `turn.*`. **Aucun champ ni événement « skill ».**

---

## 5. Modèle de données produit (`data.json`)

- `PLUGINS` : `[{id, name, short, usage (0..1 vs max calls), calls, turns, kind ('plugin'|'core'|'skill'), desc, files[]}]`
- `LINKS` : `[[a, b, poidsVisuel (0..1 global), coTurns (brut)]]`
- méta : `windowDays`, `totalEvents`, `generatedAt`, `source`
- **Groupement** : par préfixe — point → connecteur (`codex_apps.github_search` → `codex_apps`), underscore → famille (`memory_store` → `memory`).
- **Filtrage des nœuds** : on garde les **connecteurs** (dotted) + les **skills** (`skill:*`) + l'**allowlist** `includeGroups`
  (défaut bash, cron, message, memory). Exclus par défaut : `web`, `apply`, `sessions`, `session`, `lobster`.
- **Skills** : nœuds `skill:<nom>`, poids = nb de **tours** où le `SKILL.md` a été lu (proxy, cf. §6).

**Résultat type réel (test direct, 30j)** : `{plugins:14, skills:9, files:14, links:34, events:1144}`
(5 nœuds plugins/cœur : bash, message, cron, memory, codex_apps ; + 9 skills).

---

## 6. Skills — méthode et limites

- **OpenClaw ne trace pas l'usage des skills** : pas d'événement, pas de champ. Confirmé par dump de schéma
  **et** doc officielle (https://docs.openclaw.ai/automation/hooks , https://docs.openclaw.ai/tools/skills).
  Le modèle les utilise « naturellement » (injectés en bloc XML dans le system prompt), sans trace.
- **Proxy retenu** : détecter les lectures de `skills/<nom>/SKILL.md` dans les `arguments` des `tool.call`
  (hors `apply_patch`), **dédupliquées par tour**. Quand le modèle applique un skill, il lit son `SKILL.md`.
- **Limites assumées** :
  - **Sous-compte** la réutilisation intra-session (si le `SKILL.md` reste en contexte, pas de relecture → pas compté).
    Un `/new` entre deux tâches force une relecture → comptage séparé.
  - **Biaisé** vers les méta-skills de dev (`self-improving-agent` 15 tours, `skill-creator`) qui lisent les autres skills.
  - Les skills métier (CIR…) **n'apparaissent pas** → pas utilisés sur cette instance OpenClaw.
- **Pas de causalité skill→skill** : seulement co-occurrence (même tour) + ordre temporel (`seq`/`ts`) comme indice faible.

---

## 7. Frontend

- Design « globe 3D » (Claude Design). **Pas de build** : React + Babel-standalone via CDN, `.jsx` transpilés dans le navigateur.
- `index.html` (réécrit) : **fetch `./data.json`** → `window.PLUGINS/LINKS/__OC_META__`, fallback `data.fallback.js`, puis `root.render(<OpenClawApp/>)`.
- `app.jsx` (recâblé) : vrais compteurs (`p.calls`, `__OC_META__.totalEvents`) au lieu de la formule bidon `usage*1840` ;
  libellés **30 jours** dynamiques (sauf un libellé « 30j » codé en dur dans FocusCard) ; **« how to read » supprimé** ;
  **FocusCard** affiche le **% directionnel** = `coTurns / turns du nœud`.
- `network.jsx` lit déjà `LINKS` en `[a,b,w,count]` (= notre format).
- ⚠️ **`data.fallback.js` = jeu de DÉMO** (`memory-lancedb`, `project-mgmt`, `code-search`…), **sans rapport avec les vraies données**.
  Si `data.json` est absent, le viewer affiche ce faux jeu, pas un graphe vide.

---

## 8. Déploiement & exploitation

**Modifs Docker Compose faites** (`~/openclaw/docker-compose.yml`) :
- `openclaw-gateway` → `ports:` : ajout de `"127.0.0.1:8742:8742"`.
- `openclaw-cli` → `environment:` : ajout de `TMPDIR: /home/node/.openclaw/tmp` ← **c'est LE fix vérifié de l'EXDEV**.
- Restes inoffensifs : un `TMPDIR` aussi sur `openclaw-gateway` (1er edit) et un bind `_gittmp:/tmp` orphelin sur `openclaw-cli`. Peuvent être retirés.

**Cycle de mise à jour** :
1. Modif code (recompiler les `.ts`) → commit + push (cache d'identifiants).
2. Sur le VPS :
   ```bash
   openclaw plugins uninstall plugin-network     # répondre y
   openclaw plugins install git:github.com/TristanBqn/neuronal_skills@main
   cd ~/openclaw && docker compose restart openclaw-gateway
   ```
3. **Lancer le viewer en arrière-plan EN DERNIER** (un `restart` tue ce process) :
   ```bash
   docker compose exec -d openclaw-gateway sh -lc '
   cd $(ls -d /home/node/.openclaw/git/*/repo | head -1);
   node --input-type=module -e "
   import { generateSnapshot } from \"./src/aggregate.js\";
   import { ensureViewerServer } from \"./src/server.js\";
   import path from \"node:path\";
   const viewerDir = path.resolve(\"viewer\");
   await generateSnapshot({ sessionsDir: \"/home/node/.openclaw/agents\", windowDays: 30, outputPath: path.join(viewerDir,\"data.json\"), includeGroups: [\"bash\",\"cron\",\"message\",\"memory\"], logger: { info: console.log, warn: console.warn } });
   await ensureViewerServer({ viewerDir, port: 8742, host: \"0.0.0.0\", idleShutdownMs: 21600000, logger: { info: console.log, warn: console.warn } });
   setInterval(()=>{}, 1073741824);
   " > /tmp/viewer.log 2>&1
   '
   ```
4. Vérifier (pas de `wget` dans le conteneur → `node`) :
   ```bash
   docker compose exec openclaw-gateway node -e "fetch('http://127.0.0.1:8742/').then(async r=>{const t=await r.text();console.log('OK',r.status,t.slice(0,60))}).catch(e=>console.log('DOWN',e.message))"
   ```
5. **Accès** (PowerShell Windows) : `ssh -L 8742:127.0.0.1:8742 openclaw@116.203.102.30`, laisser ouvert,
   puis navigateur **http://localhost:8742/** + **Ctrl+F5**.

**Test direct du backend** (sans viewer ni agent) :
```bash
docker compose exec openclaw-gateway sh -lc 'cd $(ls -d /home/node/.openclaw/git/*/repo | head -1); node --input-type=module -e "import { generateSnapshot } from \"./src/aggregate.js\"; const s = await generateSnapshot({sessionsDir:\"/home/node/.openclaw/agents\", windowDays:30, outputPath:\"/tmp/data.json\", includeGroups:[\"bash\",\"cron\",\"message\",\"memory\"], logger:{info:console.log,warn:console.warn}}); console.log(JSON.stringify(s));"'
```

---

## 9. Ce qui a FONCTIONNÉ (vérifié)

- Parsing des trajectoires natives : ~308 ms, 33 fichiers, 1144 appels.
- Groupement outils/plugins + co-occurrence par `turnId`.
- Proxy de suivi des skills (lectures de `SKILL.md`).
- Indicateur directionnel (`coTurns/turns`) dans le panneau de détail.
- **git push** depuis l'instance (identifiants en cache).
- **Ancien** front : rendu confirmé à l'écran via le tunnel.

## 10. Ce qui n'a PAS fonctionné (et pourquoi)

1. **Hypothèse knostic** → faux ; pivot vers trajectoires natives.
2. **Install d'un plugin TS pur** → échec : `git:` exige du **JS compilé**. Fix : compiler, `extensions:["./index.js"]`, committer le JS.
3. **EXDEV à l'install** (`cross-device link not permitted`, `/tmp`→`/home/node/.openclaw/git`) :
   `/tmp` (overlay) et le volume sont sur des mounts différents → `rename()` interdit.
   **Fix VÉRIFIÉ** : `TMPDIR=/home/node/.openclaw/tmp` sur **`openclaw-cli`** → le clone se fait dans le **même mount** que la destination, l'install réussit.
   *(Note : les tentatives par bind `/tmp` avaient d'abord échoué car placées sur le mauvais service ; l'idée « deux binds = deux mounts → EXDEV » est une explication plausible mais n'a pas été isolée en test. Le fix retenu et prouvé est TMPDIR-sur-cli.)*
4. **Registre via CLI** : `toolNames` vide (plugins « derived/disabled ») → inexploitable. **Dépendance au registre abandonnée** ; groupement par préfixe.
5. **Agent gpt-5.5 « bloqué 2 min »** : ce n'était PAS l'outil (308 ms) mais l'agent (`compaction failed / Connection error`).
   **Contournement** : lancer le viewer via un **process node de fond** (`docker compose exec -d`), sans l'agent.
6. **iCloud Drive** : renomme les fichiers en doublons `" 2"` (`index 2.ts`, `openclaw.plugin 2.json`, `app 2.jsx`) pendant les éditions → repo corrompu plusieurs fois.
   Réparé à chaque fois (`git mv`), mais **danger permanent** : `git status` avant chaque commit. *(Idéalement : sortir le projet d'iCloud.)*
7. **git push lancé sur le VPS** au lieu du PC Windows (confusion d'invite SSH vs PowerShell) → doit tourner sur Windows.
8. **Auth GitHub par mot de passe refusée** → utiliser un **PAT** (token classic, scope `repo`) ou le navigateur GCM. Ensuite identifiants en cache.
9. **`wget` absent** du conteneur → checks via `node -e "fetch(...)"`.
10. **`gateway-restart` tue le viewer de fond** → relancer le viewer **après** le restart.

---

## 11. État ouvert / À VÉRIFIER en priorité

- **⚠️ Le NOUVEAU front (globe) n'a PAS encore été confirmé à l'écran.** Il a été poussé + réinstallé + le serveur a loggé
  `SERVER UP`, mais un `gateway-restart` l'a tué et le navigateur n'a pas été rechargé dessus. **Au dernier check, le serveur était `DOWN`.**
  → 1re action de reprise : relancer le viewer (§8.3), vérifier `OK 200` (§8.4), ouvrir le tunnel + http://localhost:8742/ + Ctrl+F5,
  et **confirmer visuellement** que le globe s'affiche avec les vraies données (14 nœuds dont 9 skills).
- Dernier commit poussé : intégration du front globe (`28305d3`).

---

## 12. Limites connues / dette

- Skills = **proxy** imparfait (cf. §6).
- Viewer **non auto-servi** : process de fond à relancer (ou via l'outil de l'agent). Pas démarré au boot.
- `FocusCard` libellé « 30j » **en dur** (les autres libellés sont dynamiques via `windowDays`).
- iCloud hostile à l'édition (renommages).
- **Sécurité** : `GOG_KEYRING_PASSWORD` et l'email Google sont **en clair** dans `docker-compose.yml` et ont été exposés
  dans le terminal → **à changer et déplacer vers `.env`** (non versionné).

---

## 13. Pistes / TODO

- **Confirmer le nouveau front** (cf. §11) — priorité.
- Distinguer visuellement les nœuds `skill:` via le champ `kind` (`plugin`/`core`/`skill`) — couleur/forme dédiée.
- Rendre dynamique le libellé `FocusCard` (`windowDays`).
- Arêtes **orientées** skill→skill via l'ordre de lecture dans le tour (proxy assumé).
- **Auto-servir** le viewer (démarrage au boot du gateway, ou cron de relance).
- **Compter les souvenirs LanceDB** (investigation entamée, non finie : localiser `~/.openclaw/...lancedb...`, puis compter via la lib lancedb Node dans le conteneur — ne pas inventer de commande).
- Nettoyer le repo : supprimer `src/registry.*` (orphelin) ; retirer les restes Docker (`TMPDIR` gateway, bind `_gittmp`).
