# Calendario Achiperros FC

Calendario `.ics` con los partidos de **ACHIPERROS FC** (todas las competiciones de la temporada actual), extraídos de [Competize](https://www.competize.com/es/team/view/2538202-achiperros-fc).

Página para suscribirse: https://achiperrosfc.com/

## Actualización automática

El calendario se actualiza solo **varias veces al día** (en las franjas en que se
juegan los partidos de las ligas FINDE y LABORAL) y se publica en GitHub Pages.

Competize protege su web con un anti-bot (AWS WAF) que bloquea a los clientes HTTP
normales. Por eso la actualización se hace desde un servidor externo: un navegador
headless resuelve el desafío anti-bot, reutiliza las cookies y ejecuta `scraper.py`,
que regenera `achiperros.ics`, los datos de la web y las estadísticas.

El GitHub Action (`update.yml`) y el Worker de Cloudflare siguen disponibles como
respaldo y para actualizar a mano.

**Suscribirse (iPhone):** Ajustes › Calendario › Cuentas › Añadir cuenta › Otra › Añadir calendario suscrito, y pegar:

```
https://achiperrosfc.com/achiperros.ics
```

Actualizar a mano: pestaña *Actions* › *Actualizar calendario* › *Run workflow*.
