# LJtex

*(antes «Manuscrito»; tus datos siguen en `~/Manuscrito-datos/`, no hace falta moverlos)*

Editor LaTeX colaborativo con historial y diff. Pantalla de proyectos (los modificados más recientemente, primero, con fecha y hora; búsqueda; **etiquetas** para clasificarlos, con filtro y opción de agrupar por etiqueta; y en el menú ⋯ de cada proyecto: abrir, **duplicar**, cambiar nombre, etiquetas y eliminar), árbol de archivos (texto e imágenes) y un historial por archivo.

- **Duplicar un proyecto** copia todos sus archivos (con el texto más reciente, incluso lo que alguien acaba de escribir) y sus etiquetas; el historial de la copia empieza de cero. Cambiar el nombre o las etiquetas no altera el orden por fecha de modificación.
- **Historial** (botón en la barra superior): línea de tiempo de todo el proyecto, agrupada por día. Cada entrada muestra la hora, el archivo, quién hizo el cambio (cada persona con su color), líneas añadidas y quitadas, palabras netas, la sección de LaTeX donde cambió y una vista previa del texto. Al elegirla se ve el diff lado a lado (frente a la versión anterior o frente al texto actual) con botones para saltar entre cambios. También registra quién creó, subió, movió o eliminó archivos. Se puede filtrar por archivo (clic en el árbol), por autor y ocultar los guardados automáticos.
- **Restaurar**: desde una versión, «Restaurar esta versión» devuelve ese archivo a ese estado. Antes se guarda lo que hubiera sin guardar, y quien tenga el archivo abierto ve el cambio al instante.
- **Restaurar el proyecto completo**: «Restaurar todo el proyecto a este momento» (en una versión) o «Volver a antes de este cambio» (en un alta, baja, movimiento o restauración). Antes de aplicarlo muestra qué archivos se restaurarán, se recrearán, se eliminarán o se renombrarán; recupera también imágenes y archivos eliminados. Se guarda siempre una copia del estado anterior, así que se puede deshacer desde el Historial. Funciona con los cambios hechos desde que existen estas copias; las entradas más antiguas solo permiten restaurar el archivo.
- Las copias del proyecto guardan cada contenido una sola vez (por hash), en la tabla `blobs`, y se limpian al borrar el proyecto.
- **Atajos de teclado** (⌘ en Mac, Ctrl en el resto; el botón ⌨ de la barra superior muestra la lista): ⌘Enter o ⌘S compilan; ⌘⇧S guarda una versión con nombre; ⌘⇧H abre o cierra el Historial; ⌘B, ⌘I y ⌘E ponen la selección en negrita, cursiva o énfasis (`\textbf{}`, `\textit{}`, `\emph{}`; si ya lo está, lo quitan); ⌘/ comenta con `%`; ⌘F busca; Esc cierra ventanas o sale del Historial.
- **Sugerencias al escribir**: menú flotante con `\` (comandos, símbolos y operadores; dentro de una fórmula salen primero los matemáticos), `\begin{` y `\end{` (entornos; al elegir uno se escribe también su `\end`, y `\end{` propone el entorno abierto), `\cite{` (claves de tus archivos `.bib`, con autor y año), `\ref{` y `\eqref{` (los `\label` de todo el proyecto), `\input{`, `\includegraphics{` y `\bibliography{` (archivos del proyecto), `\usepackage{` y `\documentclass{`. Enter o Tab aceptan; Tab salta entre huecos de la plantilla; Ctrl+Espacio lo abre a mano; Esc lo cierra.
- **Errores de compilación**: el panel bajo el PDF muestra primero los errores (archivo y línea, con enlace para saltar a ella, el texto donde se detuvo y una pista en español; si falta un paquete, el comando `sudo tlmgr install …` con botón de copiar). Los avisos y el registro completo van plegados. Si LaTeX consigue generar el PDF a pesar de los errores, se muestra igualmente.
- **Asistente de Claude** (botón «✦ Asistente» o ⌘J; solo para uso personal en tu propia computadora): un panel donde le pides cosas a Claude («corrige la ortografía», «traduce», «arregla los errores de compilación»…). Si seleccionas texto en el editor, trabaja solo sobre esa selección. No toca nada directamente: copia el proyecto a una carpeta temporal, ejecuta ahí tu Claude Code y te muestra los cambios como propuesta, archivo por archivo, con vista de diff, para que los aceptes o rechaces. Lo aceptado entra al historial con el autor «Claude» y se puede deshacer como cualquier otro cambio.
  - Las respuestas del asistente se muestran con **Markdown** (negritas, listas, tablas, enlaces) y **fórmulas matemáticas** (KaTeX: `$…$`, `$$…$$`, `\(…\)`, `\[…\]`), y los bloques de código tienen botón «Copiar». El HTML se sanea y no se muestran imágenes. Tras actualizar hay que ejecutar `npm install` (librerías `marked`, `katex` y `dompurify`).
  - **Conversaciones guardadas**: cada proyecto conserva sus conversaciones con el asistente (en la misma base de datos, fuera de la carpeta del programa). Al abrir el panel vuelves a la última; «Conversaciones» lista las anteriores para reabrirlas o borrarlas, y «＋ Nueva» empieza otra. Las propuestas pendientes siguen disponibles aunque cierres o recargues (se conservan 60 días), y una petición en marcha se retoma al recargar.
  - Requiere tener instalado Claude Code e iniciada la sesión con tu cuenta (en la Terminal: `claude`, y dentro `/login`). Manuscrito no ve ni guarda tus credenciales: solo lanza el programa oficial. Usa los límites de tu plan.
  - Solo funciona si abres Manuscrito desde la misma computadora donde corre; los coautores conectados desde otro equipo no lo ven disponible.
  - El asistente solo puede leer y editar los archivos de texto del proyecto (sin terminal, sin internet). Si hay una clave `ANTHROPIC_API_KEY` en tu entorno se ignora, para que no se cobre a la API (con `AGENT_USE_API_KEY=1` se respeta). Otras variables: `CLAUDE_BIN` (ruta del programa), `AGENT_MODEL`, `AGENT_TIMEOUT_MIN` (por defecto 8).
- Las versiones se crean solas cuando otra persona toma el relevo editando, cada 5 minutos de edición continua y al cerrar el último coautor; además puedes guardar versiones con nombre («Guardar versión»).
- Renombrar o mover: lápiz ✎ junto a cada archivo o carpeta (escribe la ruta nueva, por ejemplo `figuras/a.png`) o arrastrar y soltar sobre una carpeta. Soltar sobre el nombre del proyecto lo saca a la raíz. El historial y la edición en vivo se conservan.
- Las carpetas existen mientras tengan archivos: para crear una, ponle ruta a un archivo (`capitulos/intro.tex`).
- El archivo que se compila debe llamarse `main.tex` y estar en la raíz.

    npm install
    TOKEN=una-clave-larga npm run dev      # http://localhost:5173
    # producción: npm run build && TOKEN=... npm start  (sirve en :3000, abre también el puerto 1234)

- **Solo tu computadora**: por seguridad LJtex atiende únicamente a la propia Mac (127.0.0.1); nadie más en la misma red Wi-Fi puede entrar. Para usarlo como servidor de grupo, ábrelo a la red con `LJTEX_HOST=0.0.0.0 TOKEN=una-clave-larga npm start` (con la clave de ejemplo `cambia-esto` se niega a arrancar). El contenedor de Docker ya trae `LJTEX_HOST=0.0.0.0`.
- **Pruebas**: `npm test` comprueba la mezcla de cambios con GitHub (que ninguna edición tuya ni de tu coautor se pierda). Córrelo antes de generar el .dmg si tocaste `github.js`.

- Colaboración: Yjs + Hocuspocus (puerto 1234), documentos guardados en SQLite.
- **Dónde están tus datos**: en `~/Manuscrito-datos/data.db`, fuera de esta carpeta, así que puedes reemplazar o borrar la carpeta del programa sin perder proyectos. Al primer arranque se copia ahí el `data.db` que hubiera en la carpeta. Haz copias de seguridad de ese archivo. Con otra ruta: `DB=/ruta/data.db`.
- Versiones automáticas (máx. una cada 5 min) y con nombre, en la tabla `versions`.
- Diff: @codemirror/merge frente a la versión anterior.
- Detrás de HTTPS cambia `ws://` por `wss://` en `src/main.js` y usa un proxy inverso (Caddy/nginx).

## Compilar a PDF

Necesita `latexmk` y TeX Live. Dos opciones:

- **Docker (recomendado, sobre todo en Windows)**:

      docker build -t manuscrito .
      docker run -p 3000:3000 -p 1234:1234 -e TOKEN=mi-clave -v manuscrito-data:/data manuscrito

  Abre http://localhost:3000
- **Local**: instala TeX Live (Linux: `sudo apt install latexmk texlive-latex-extra texlive-lang-spanish`; Mac: MacTeX o BasicTeX) y usa `npm run dev`.

## Importar y exportar proyectos (.zip)

- **Importar:** en la página de proyectos pulsa **Importar .zip** o arrastra el archivo a la ventana. Funciona con el que descargas de Overleaf (Menú → Descargar → Fuente). Se quita la carpeta raíz, se ignoran `__MACOSX`, `.DS_Store` y los archivos auxiliares de LaTeX (`.aux`, `.log`…), los `.tex`/`.bib` en Latin-1 se convierten a UTF-8 y, si no hay `main.tex`, el único `.tex` con `\documentclass` se renombra a `main.tex`. Si algo se omite o se renombra, verás un resumen.
- **Por seguridad** no se importan `latexmkrc` / `.latexmkrc` (latexmk los ejecutaría como código) y la compilación usa `-norc`. Límites: .zip de hasta 150 MB, 400 MB y 3000 archivos descomprimido.
- **Exportar:** botón **Descargar .zip** en el proyecto, o **Exportar .zip** en el menú ⋯ de cada tarjeta (incluye el texto más reciente). El historial no va dentro del .zip.
- **Descargar PDF:** en la barra del PDF, después de compilar.
- Necesita la dependencia nueva `fflate`: ejecuta `npm install` tras actualizar.

## Paneles ajustables

En un proyecto puedes arrastrar los divisores entre el árbol de archivos, el código, el PDF y el asistente para cambiar su tamaño (doble clic = tamaño original; con el divisor enfocado, las flechas ← → lo mueven). Los botones **Archivos / Código / PDF** de la barra superior los muestran u ocultan (siempre queda visible el código o el PDF). Tu distribución se recuerda en este navegador.

## Saltar entre el código y el PDF (SyncTeX)

- **Del código al PDF:** pon el cursor en una línea y pulsa **Código → PDF** (o ⌘⌥Enter / Ctrl+Alt+Enter); el PDF se desplaza y marca ese lugar. Si el PDF estaba oculto, se muestra.
- **Del PDF al código:** doble clic (o ⌘/Ctrl + clic) sobre el texto del PDF; el editor salta a esa línea, aunque sea de otro archivo del proyecto.
- El PDF se muestra ahora con un visor propio (pdf.js): puedes seleccionar y copiar texto, acercar/alejar con **− +** o con Ctrl/⌘ + rueda, y conserva la posición al recompilar.
- Requiere el comando `synctex`, que viene con TeX Live / MacTeX / BasicTeX. Hay que compilar al menos una vez; si editas después de compilar, las líneas pueden desfasarse hasta recompilar.
- Dependencia nueva `pdfjs-dist`: ejecuta `npm install` tras actualizar.

## Corrector ortográfico

Las palabras mal escritas se subrayan con una línea roja ondulada (solo en `.tex`, `.md` y `.txt`). Se revisa únicamente la prosa: no los comandos, fórmulas, comentarios, preámbulo ni claves de `\cite`/`\ref`; tampoco siglas, palabras con números ni nombres como LaTeX.

- **Clic derecho** sobre una palabra subrayada: sugerencias, **Añadir al diccionario** o **Ignorar**.
- **Botón «Ortografía»** de la barra superior: activar o apagar el corrector, elegir idiomas (español, English US/UK, français, Deutsch, português, italiano, català) y ver o quitar las palabras de tu diccionario. Con varios idiomas marcados, una palabra es correcta si lo es en cualquiera de ellos (por defecto español e inglés).
- Todo es local: los diccionarios (Hunspell) vienen en `node_modules` y se descargan una vez al navegador; la revisión corre en un hilo aparte. Tus ajustes y tu diccionario se guardan en este navegador.
- Dependencias nuevas (`nspell` y `dictionary-*`): ejecuta `npm install` tras actualizar.

## El asistente recuerda la conversación

Cada petición arranca una ejecución nueva de Claude, así que ahora se le envía la conversación anterior (lo que pediste, lo que respondió y qué pasó con sus cambios: aceptados, rechazados o sin aceptar) y la línea donde está tu cursor. Si dice que hizo cambios pero no modificó ningún archivo, o si falló al editar, aparece un aviso amarillo con el botón «Pedirle que lo haga en el archivo».

Si el asistente afirma haber editado y no aparecen cambios, el aviso dice por qué (sin herramientas de edición, edición bloqueada por permisos, ruta fuera del proyecto…). Además, la última petición queda registrada en `~/Manuscrito-datos/agente-ultimo.log` (qué herramientas tuvo, qué intentó editar y qué detectó Manuscrito).

## Buscar en el PDF

Botón **Buscar** en la barra del PDF, o ⌘F / Ctrl+F después de hacer clic en el PDF (con el foco en el editor, ⌘F sigue buscando en el código). Ignora mayúsculas y acentos, resalta todas las coincidencias (la actual en naranja), cuenta los resultados y salta con Enter / Mayús+Enter o con ↑ ↓. Esc cierra. La búsqueda se mantiene al recompilar o cambiar el zoom.

## Plegar secciones y entornos

Junto al número de línea aparece una flechita (⌄) en cada `\section`, `\subsection`, `\chapter`… y en cada `\begin{…}` que abre un entorno de varias líneas. Clic para plegar (queda «⋯ 12 líneas»; clic ahí para desplegar). Una sección incluye todo hasta la siguiente del mismo nivel o superior; un entorno conserva visible su `\end{…}`. También por teclado: **⌘⌥[ / ⌘⌥]** (Ctrl+Shift+[ / ] fuera de Mac) pliega o despliega el bloque del cursor, y **Ctrl+⌥[ / Ctrl+⌥]** pliega o despliega todo. Saltar a una línea oculta (por ejemplo desde un error de compilación o desde el PDF) la despliega sola.

## Archivo principal
Manuscrito compila el archivo principal del proyecto, que por defecto es `main.tex`. Si tu proyecto (por ejemplo, uno importado de Overleaf) usa otro nombre, cámbialo así:
- Botón **Principal: …** en la barra del PDF: eliges de una lista (los archivos con `\documentclass` aparecen primero).
- En el árbol de archivos, pasa el cursor sobre un `.tex` y pulsa **☆**. El principal aparece con **★**.

Al importar un `.zip` sin `main.tex`, se marca automáticamente el `.tex` que contiene `\documentclass` (sin renombrar nada). Si renombras o mueves el archivo principal, sigue siendo el principal; al duplicar el proyecto se conserva. No hace falta `npm install`: la base de datos se actualiza sola al reiniciar.

## Vista previa de fórmulas
Pasa el cursor (≈0,3 s) sobre una fórmula —`$…$`, `$$…$$`, `\(…\)`, `\[…\]`, `equation`, `align`, `gather`, etc.— y aparece renderizada sobre el código. Usa los `\newcommand`, `\def` y `\DeclareMathOperator` de tu archivo. Ignora comentarios y `\$`. Es solo una vista aproximada (KaTeX): el PDF sigue siendo la referencia.

**Compilar el archivo abierto:** si el archivo que tienes abierto es un documento completo (contiene `\documentclass`), «Compilar» compila ese archivo, aunque no sea el principal; el estado muestra cuál. Si abres un capítulo (sin `\documentclass`), se compila el archivo principal.

## Agregar referencias por DOI o arXiv
Botón **＋ Referencia (DOI / arXiv)** bajo el árbol de archivos. Pega un DOI (o el enlace de doi.org) o un identificador/enlace de arXiv; la app consulta Crossref o arXiv, te muestra la entrada BibTeX (editable) y la agrega a un `.bib` del proyecto (crea `referencias.bib` si no hay ninguno). Genera la clave (`apellido+año`, con una letra si ya existe), avisa si el DOI ya estaba y ofrece copiar o insertar el `\\cite{clave}`. Es lo único que sale a internet y solo cuando lo usas: se envía el identificador, nunca tu texto. El autocompletado de `\\cite{`, `\\ref{` y `\\eqref{` usa las claves de todos tus `.bib` y las etiquetas de todos tus `.tex`.

## Esquema del documento
Pestaña **Esquema** arriba del árbol de archivos. Muestra secciones, subsecciones, resumen, apéndices y bibliografía, y (si lo dejas marcado) los enunciados: teoremas, lemas, proposiciones, definiciones, etc., incluidos los que definas con `\\newtheorem`. Sigue los `\\input`/`\\include` desde el archivo que compilas, así que ves el documento completo aunque esté repartido en archivos. Un clic salta a esa línea; el elemento donde está tu cursor aparece resaltado. Se actualiza mientras escribes.

## Vista previa de referencias en el PDF
Al pasar el cursor sobre un enlace interno del PDF (un `\ref`, `\eqref`, `\cref` o una cita) aparece un recuadro con el trozo de página al que apunta: el enunciado del teorema, la ecuación o la entrada de la bibliografía. Requiere `hyperref` (o `cleveref`) en tu documento. El recorte es una franja de altura fija desde el inicio del destino.

## Comprobación de compilación del asistente
El asistente no puede ejecutar LaTeX, así que ya no dice «no pude compilar». En su lugar, cuando propone cambios, la aplicación compila por su cuenta el documento *con esos cambios* (en una carpeta temporal, sin tocar tu proyecto) y te lo dice en la conversación: «✓ compila sin errores», «⚠ compila con errores: …» (solo los que causan los cambios) o «sigue teniendo los errores que ya tenía». Añade unos segundos antes de ver la propuesta.

## Que el asistente lea un PDF o una imagen del proyecto
Escribe el nombre del archivo en tu petición («lee articulo.pdf y resume el teorema 2») y el asistente recibe una copia de solo lectura para leerlo. Si el proyecto tiene un único PDF, basta con decir «el pdf». Solo se prestan los archivos nombrados (hasta 20 MB en total), porque leer un PDF largo gasta bastantes tokens en cada petición. Los demás archivos binarios quedan fuera y el asistente te pedirá su nombre si los necesita.

## Enlaces a archivo y línea en las respuestas del asistente
Cuando el asistente cita un lugar («main.tex:42», «main.tex, línea 42», «líneas 10–15 de cap/uno.tex»), la cita es un enlace: un clic abre ese archivo y selecciona esa línea (o ese rango). Solo se enlazan archivos que existen en el proyecto. Las líneas son las del archivo cuando le hiciste la petición: si luego editaste, pueden haberse movido.

## Referencias clicables en las respuestas del asistente
Cuando el asistente cita `archivo.tex:12`, «línea 12 de archivo.tex» o «cap. 4, l.389-395 y 432», cada cita se vuelve un enlace que abre ese archivo y selecciona esas líneas. Para «cap. N» busca el único `.tex` cuyo nombre contenga ese capítulo; una «l.N» suelta usa el último «cap. N» mencionado en el mismo párrafo, fila o viñeta, o si no el archivo que tenías abierto al pedir. Si no se puede determinar el archivo, no se enlaza. Los enlaces se calculan al mostrar, así que también funcionan en conversaciones antiguas.

## Implementar sugerencias de la respuesta del asistente
Bajo cada sugerencia de una lista en las respuestas del asistente aparecen dos botones: **Implementar** (le pide hacer justo ese cambio, con el nombre de su sección) y **Con comentarios…** (abre un cuadro para añadir tus indicaciones antes de enviar). Los cambios llegan como siempre, para aceptarlos o rechazarlos. Los botones se ocultan mientras el asistente trabaja.

## Resolver errores de compilación con IA
En el panel de errores, cada error trae el botón **Resolver con IA** (y arriba, **Resolver todo con IA** cuando hay varios). Abre el asistente y le pide arreglar ese error, con archivo, línea y contexto; los cambios llegan para aceptarlos o rechazarlos.

## Indicador de compilación
Mientras se compila, el botón **Compilar** muestra un circulito girando y dice «Compilando»; al terminar desaparece.

## Usar LJtex en dos Mac (programa con git, proyectos con iCloud)
Pensado para que uses **una Mac a la vez** (no es colaborativo).

**Programa (git + GitHub privado).** Una sola vez, en la Mac donde está el código:
`git init && git add . && git commit -m "LJtex"`, crea un repositorio *privado* en GitHub y `git remote add origin <url> && git push -u origin main`. El `.gitignore` deja fuera `node_modules`, `dist` y toda base de datos (tus manuscritos nunca se suben). En la otra Mac: `git clone <url>`, `npm install`, `npm run build`. Después, al cambiar algo en una: `git add -A && git commit -m "…" && git push`; en la otra: `git pull && npm install && npm run build`.

**Proyectos (carpeta de iCloud Drive).** Mueve la carpeta `~/Manuscrito-datos` a iCloud Drive (p. ej. `~/Library/Mobile Documents/com~apple~CloudDocs/LJtex-datos`; en Finder: arrástrala a iCloud Drive) y, en **cada** Mac, arranca con la variable `LJTEX_DATA` apuntando a esa carpeta:
`LJTEX_DATA="$HOME/Library/Mobile Documents/com~apple~CloudDocs/LJtex-datos" TOKEN=… npm start`.
Haz clic derecho en la carpeta → **Mantener descargado** para que iCloud no la «optimice» y deje la base solo en la nube.

Protecciones incluidas:
- **Candado «en uso»**: mientras LJtex corre escribe `data.db.lock` con el nombre de la Mac (latido cada 30 s). Si abres LJtex en la otra Mac con la primera todavía abierta, no arranca y te dice cuál. Si una Mac se cerró de golpe, el candado caduca solo a los 2 min (o usa `LJTEX_FORCE=1`).
- **Al cambiar de Mac**: cierra LJtex en la primera (Ctrl+C) y espera a que iCloud termine de subir (nube sin flecha en Finder) antes de abrirlo en la otra.
- **Integridad**: al abrir, comprueba que la base no esté dañada o a medio sincronizar y, si lo está, no la toca.
- **Respaldos**: copia automática en `respaldos/` al abrir y cada 12 h (guarda las últimas 7). Para restaurar, cierra LJtex y reemplaza `data.db` por una de esas copias.
- Si iCloud crea copias en conflicto (`data 2.db`…), LJtex lo avisa al arrancar.

## App de escritorio (LJtex.app / .dmg)

**Pestañas.** Cada proyecto puede abrirse en su propia pestaña (pestañas nativas de macOS, como en Safari): ⌘T abre una pestaña nueva, ⌘-clic en un proyecto lo abre en otra pestaña, y el botón junto al nombre del proyecto lo abre otra vez en una pestaña aparte (útil para ver dos archivos del mismo proyecto; lo que se escribe en una aparece al instante en la otra). Al salir, LJtex pregunta pestaña por pestaña si hay cambios sin subir a GitHub. Si dos pestañas compilan a la vez, la segunda espera su turno.

**Actualizaciones sin terminal.** En cada cambio que llega a `main`, la acción de GitHub *Construir LJtex* (`.github/workflows/dmg.yml`) corre las pruebas, genera los .dmg (chip Apple e Intel) en una Mac de GitHub y los publica como *Release* (se conservan los 5 más recientes). Dentro de LJtex, el botón **Buscar actualizaciones** de la pantalla de proyectos (o el menú *LJtex → Buscar actualizaciones…*) descarga la versión nueva, cierra LJtex, reemplaza la app y la vuelve a abrir. Además, LJtex lo revisa solo cada 6 horas y avisa en la pantalla principal.

- Usa la misma clave de GitHub que la sincronización de proyectos. Cada persona necesita **acceso de lectura a este repositorio** (por ser privado): invítala como colaboradora en GitHub → *Settings → Collaborators*.
- La primera vez hay que instalar a mano un .dmg que ya traiga el actualizador: descárgalo de la pestaña *Releases* del repositorio (o genera uno con `npm run dist`).
- Cada app sabe de qué cambio se construyó por `build-info.json` (lo crea `scripts/build-info.mjs`).
`npm run app` abre LJtex como app (ventana propia, sin navegador): arranca el servidor interno con una clave aleatoria (no tienes que escribir ninguna), y al cerrar la ventana lo detiene y sube los cambios a iCloud.
`npm run dist` genera en `release/` los instaladores `LJtex-<versión>-arm64.dmg` (Mac con chip Apple) y `LJtex-<versión>-x64.dmg` (Intel); `npm run dist:arm` o `npm run dist:intel` generan solo uno. Hay que correrlo en una Mac. La app va firmada «ad hoc» (sin cuenta de Apple): la primera vez se abre con clic derecho → Abrir, o con `xattr -dr com.apple.quarantine /Applications/LJtex.app`.
Se instala arrastrándola a Aplicaciones; se ancla al Dock como cualquier app. Necesita LaTeX (MacTeX/BasicTeX) y, para el asistente, Claude Code (`claude`) instalado e iniciado en esa Mac; la app busca ambos en los lugares habituales aunque se abra desde el Dock.
Si el instalador de npm no descarga Electron (npm 11 bloquea los scripts de instalación): `npm install-scripts approve electron better-sqlite3 esbuild` y `npm rebuild`, o `node node_modules/electron/install.js`.

## Sincronización entre Macs por iCloud (LJTEX_SYNC) — un archivo por proyecto
Cada Mac trabaja con su base **local** (`~/Manuscrito-datos/data.db`); nunca se abre una base dentro de iCloud. Si existe la carpeta `iCloud Drive/LJtex-datos` (la app la detecta sola; con el servidor se indica `LJTEX_SYNC=<carpeta>`), dentro se crea:
- `proyectos/<id>.ljproj` + `proyectos/<id>.json`: **un archivo por proyecto** (archivos, historial, instantáneas, conversaciones…; es una base SQLite con solo ese proyecto) y su manifiesto (tamaño, huella SHA-256 del archivo y huella del contenido).
- `Proyectos legibles/<nombre>/…`: copia **de solo lectura** de cada proyecto con sus archivos tal cual (`.tex`, `.bib`, imágenes…), para verlos en Finder, respaldarlos o llevarlos a git/Overleaf. Nada de ahí se vuelve a leer: los cambios hechos ahí no se importan. Si borras un proyecto, su carpeta aquí queda como última copia.
- `data.db.lock`: candado compartido con latido cada 30 s (una Mac a la vez).

**Al abrir**, para cada proyecto de la carpeta compartida: si no lo tienes, se baja; si la otra Mac lo cambió y tú no, se actualiza (tu versión anterior queda en `respaldos/antes-de-sincronizar-…`); si es igual, nada; si solo tú lo cambiaste, se sube al cerrar. Un archivo incompleto (iCloud aún sincroniza) impide abrir y te dice cuál.
**Al cerrar**: se sube cada proyecto que cambiaste (archivo temporal → verificación → renombrado atómico, y el manifiesto al final). Si la otra Mac subió una versión mientras tanto, no se pisa (tu versión queda en `respaldos/no-subido-…`). Un proyecto eliminado se elimina también en la otra Mac (con copia en respaldos).
**Conflicto** (el *mismo proyecto* cambió en las dos Macs): no se toca nada y se pregunta: conservar las dos (la otra queda como copia «… (versión de <Mac>)»), conservar la de esta Mac o usar la de iCloud (`LJTEX_SYNC_RESOLVE=both|local|remote`). Trabajar en proyectos distintos en cada Mac **no** es conflicto: se juntan solos.
Si una Mac se apaga de golpe (sin cerrar bien), no sube; sus cambios se subirán la próxima vez que cierre bien.

## Memoria de la conversación del asistente
Cada petición al asistente es una ejecución nueva, así que se le pasa la conversación: su **última respuesta completa** dentro del mensaje (hasta 40 000 caracteres; es a la que se refiere «implementa todo») y las anteriores abreviadas. Además, toda la conversación **sin recortar** (últimos 40 mensajes) se le deja como archivo de solo lectura `conversacion-anterior.md`, que puede abrir si necesita algo más antiguo. Ese archivo nunca aparece como cambio propuesto.

## Vista previa y menú contextual de archivos

- Al hacer clic en un PDF o imagen subido al proyecto se muestra su vista previa sobre el editor (con «Descargar» y «Cerrar»); al abrir un archivo de texto vuelve el editor.
- Clic derecho sobre un archivo: vista previa/abrir, renombrar o mover, descargar, usar como archivo principal, copiar `\includegraphics`/`\input`/ruta y eliminar. Sobre una carpeta: nuevo archivo, subir, renombrar y eliminar carpeta.

## Mejoras de escritura

- **Pegar imágenes** (⌘V) o **soltarlas en el editor**: se guardan en `figuras/` y se inserta `\includegraphics`. También se pueden **arrastrar archivos desde el Finder** al árbol (sobre una carpeta los mete ahí) o elegir varios con «Subir».
- **Buscar y reemplazar en todo el proyecto** (🔍 o ⌘⇧F): con mayúsculas, palabra completa y expresiones regulares; puedes excluir archivos. Antes de reemplazar se guarda una versión en el Historial.
- **Conteo de palabras** junto al nombre del proyecto (clic para ver el detalle por archivo y las páginas).
- **Plantillas** al crear un proyecto: artículo, libro, tesis, presentación (beamer), examen y vacío.
- **Modo oscuro** (☾/☀ en la barra superior; sigue al sistema la primera vez). El PDF se mantiene claro.
- **Comentarios** anclados al texto (pestaña «Comentarios», ⌘⌥M): responder, resolver, eliminar. Se guardan en el propio documento, así que se sincronizan con iCloud y con los coautores.
- **Motor de compilación** por proyecto: pdfLaTeX, XeLaTeX o LuaLaTeX (selector en la barra del PDF).

## Navegación, referencias y revisión

- **⌘+clic** (Ctrl+clic en Windows/Linux) sobre `\ref`, `\eqref`, `\cite`, `\input`, `\include`, `\includegraphics` o `\bibliography` salta a la etiqueta, la entrada del `.bib` o el archivo. Sobre un `\label` salta a su primera referencia.
- **Referencias** (🔗 o ⌘⇧R): lista las referencias sin etiqueta, las citas que no están en el `.bib`, los archivos que no existen y las etiquetas o claves repetidas; también las etiquetas y entradas sin usar. «Resolver con IA» manda los problemas al asistente.
- **Fórmula desde una imagen** (📐 o ⌘⌥V): pega, arrastra o elige una imagen; el asistente (tu sesión de Claude Code, solo local) la transcribe a LaTeX, ves la vista previa, la corriges si hace falta y la insertas en el cursor.
- **Revisión de cambios del asistente**: «Ver cambios» abre el archivo con lo que entra subrayado y lo que sale tachado; aceptas o rechazas cada cambio por separado y «Aplicar lo aceptado» guarda solo esos. «Lado a lado» conserva la vista anterior.

## Sugerencias atendidas

Cada sugerencia del asistente tiene una casilla «Atendida». Al pulsar «Implementar» o «Con comentarios…» se marca sola como «Atendida · implementada». La marca se guarda con la conversación y se puede quitar.

## Aspecto

- **Modo oscuro propio**: paleta oscura azulada (no es una inversión de colores), con colores de sintaxis para el editor; el PDF y las imágenes se mantienen claros.
- **Barra de estado** inferior: estado de la compilación, línea y columna, motor de compilación, palabras y páginas.
- **Barra del PDF** de una sola fila: Compilar, archivo principal, «Al escribir», y a la derecha buscar, «Código → PDF», zoom y descargar.

## Vista rápida, miniaturas y asistente renovado

- **Vista rápida (⚡ Rápida)**: en libros grandes, compila solo el capítulo que tienes abierto. Con `\include` usa `\includeonly` y reutiliza los `.aux` de la última compilación completa, así que conservas numeración y referencias; con `\input` omite los demás capítulos y ajusta el contador (`\setcounter{chapter}{n}`). La primera compilación de la sesión es siempre completa. El PDF parcial se descarga como «Nombre (parcial).pdf». Desactiva el botón para volver a compilar todo.
- **Miniaturas**: cada tarjeta de proyecto muestra la primera página del último PDF completo compilado. Se guardan solo en esa computadora (no se sincronizan); aparecen tras compilar allí.
- **Asistente**: tus mensajes van en burbuja a la derecha, las respuestas de Claude sin fondo y los cambios propuestos como tarjetas con el nombre del archivo, el resumen «+n −n» y los botones alineados.

## Del código al PDF
Junto al número de la línea del cursor aparece una flecha → (clic = saltar a esa línea en el PDF). También con clic derecho en el editor → «Ir al PDF», o con ⌥Enter. Hay que haber compilado antes.

## Snippets y macros propias
- **Snippets** (menú ⋯ → Snippets…): escribe una abreviatura (`thm`, `eq`, `fig`…) y pulsa **Tab**. Puedes crear, editar y borrar los tuyos; si abres el gestor con texto seleccionado, ese texto llena el nuevo snippet. `${}` marca un hueco (Tab salta al siguiente) y `${nombre}` se repite donde aparezca igual. Se guardan en esa computadora (no se sincronizan).
- **Autocompletado de tus definiciones**: al escribir `\` se sugieren tus `\newcommand`, `\renewcommand`, `\DeclareMathOperator`, `\DeclarePairedDelimiter` y `\def` (con huecos según su número de argumentos y su definición como ayuda), y en `\begin{…}`/`\end{…}` tus `\newtheorem` y `\newenvironment`. Se leen de todo el proyecto (también `.sty`/`.cls`) y del archivo abierto en el momento.

## Revisiones ordenadas: puntos con hilo propio
Cuando el asistente responde con una lista de sugerencias, cada punto tiene ahora:
- **Elegir** (casilla): marca varios puntos y pulsa **Implementar elegidos** (o «Con comentarios…» para añadir indicaciones a todos). «Elegir todos los pendientes» marca los que aún no están atendidos.
- **Implementar / Con comentarios…**: el trabajo ya **no** se mezcla con la conversación principal. Cada punto tiene su propio **hilo anidado** debajo de él (botón «▸ Hilo · estado»), con lo que hizo el asistente, la comprobación de compilación y las tarjetas para aceptar o rechazar los cambios.
- **Seguir conversando** dentro del hilo («Seguir conversando sobre este punto…»): ese asistente solo ve la revisión y el hilo de ese punto, no el resto del chat.
- **Estado** de cada punto: En cola · Trabajando… · Propuesta lista (+n −n) · Aplicada ✓ · Rechazada · Error.
- Varios puntos se hacen **uno tras otro** (el asistente atiende una petición a la vez); el botón «Detener» cancela el actual y vacía la cola. La cola no sobrevive a recargar la página, pero los hilos ya hechos sí.
- Si dos propuestas tocan el mismo archivo, al aceptar la segunda se **combinan automáticamente** (como un merge por líneas). Solo aparece «Aplicar de todos modos» si ambas tocan exactamente las mismas líneas.

## Carpetas en el árbol

- **Carpeta** (panel Archivos) o clic derecho › *Nueva carpeta aquí…* crea carpetas, también anidadas (`figuras/extra`). Las carpetas vacías se conservan con un archivo oculto `.keep`.
- **Subir carpeta** (o clic derecho en una carpeta › *Subir carpeta aquí…*) sube una carpeta entera con su estructura. También puedes **arrastrar carpetas** desde Finder al árbol (se conservan las vacías). Se omiten archivos ocultos (`.DS_Store`, `.git`) y `node_modules`.

## Adjuntos en el chat del asistente

En el panel del asistente, el botón de adjuntar (junto al selector de modelo), pegar (⌘V) o soltar archivos en el panel permiten mandar **imágenes, PDF o archivos de texto** (.tex, .bib, .txt, .csv, .md): hasta 6 por mensaje y 15 MB en total. Claude los lee con `Read` en esa petición; no se agregan al proyecto (si hay que usar una imagen en el documento, súbela al árbol de archivos).

## Recordar dónde te quedaste

Al recargar la página o volver a entrar a un proyecto, LJtex abre el último archivo, con el cursor y el desplazamiento del código donde los dejaste (por archivo), y el PDF con su zoom y su posición. Se guarda en el navegador/app de cada computadora (no se sincroniza).

## Sincronizar con Zotero

Botón **Z** junto a «Referencia» (panel Archivos). LJtex lee tu biblioteca (o una colección) desde **Zotero de escritorio, que debe estar abierto**, y la guarda como un `.bib` del proyecto (por defecto `zotero.bib`). Todo es local: no hay cuentas, claves ni internet.

- **Una sola vía:** el `.bib` se sobrescribe en cada sincronización; tus referencias propias van en otro archivo. Cada sincronización queda en el historial.
- **Activar en Zotero (una vez):** Ajustes › Avanzado › «Permitir que otras aplicaciones de esta computadora se comuniquen con Zotero» (Zotero 7 o superior).
- Con el plugin **Better BibTeX** se usan sus claves de cita estables; sin él, las claves nativas de Zotero.
- «Sincronizar al abrir este proyecto» lo hace solo al entrar (si Zotero está cerrado, no hace nada). La configuración se guarda por proyecto en cada computadora.
- Para citar: `\bibliography{zotero}` (o `\addbibresource{zotero.bib}` con biblatex). Si una clave está también en otro `.bib`, se avisa.
- Variable `ZOTERO_URL` para cambiar la dirección (por defecto `http://127.0.0.1:23119`).

## Escribir a varias manos con GitHub

Cada coautor trabaja en su propia Mac, a su ritmo; GitHub guarda la copia común del proyecto.

- **Conectar la cuenta** (una vez por computadora): botón **GitHub** del proyecto o **Abrir desde GitHub** en la lista de proyectos. Se pega una clave personal «classic» con la casilla `repo` (LJtex da el enlace ya preparado). La clave se guarda en `~/.ljtex/github.json`, solo en esa Mac.
- **Guardar un proyecto en GitHub**: botón **GitHub** › nombre del repositorio › *Crear y subir*. Crea un repositorio privado en tu cuenta.
- **Invitar a un coautor**: menú ⋯ › **GitHub…** › usuario de GitHub › *Invitar*.
- **El coautor abre el proyecto**: **Abrir desde GitHub** › *Aceptar invitación* › *Abrir en LJtex*.
- **Sincronizar**: el botón **Sincronizar** trae los cambios de los demás y sube los tuyos. Un punto en el botón avisa cuando hay cambios nuevos en GitHub.
- **Mezcla**: si dos personas cambian archivos distintos, o partes distintas del mismo archivo, todo se combina solo. Si cambian las mismas líneas, quedan ambas versiones entre tres líneas de marca (`%<<<<<<< CONFLICTO`…); se deja la buena, se borran las marcas y se vuelve a sincronizar. Mientras haya marcas, el proyecto no se sube.
- Todo va por la API de GitHub (`github.js`): no hace falta git. Cada sincronización queda en el Historial y se puede deshacer restaurando el proyecto.
- Pruebas: `LJTEX_GITHUB_API` apunta a otro servidor (p. ej. uno falso) y `LJTEX_GITHUB_CONF` a otro archivo de clave.
