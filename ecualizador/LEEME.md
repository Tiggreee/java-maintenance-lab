# Ecualizador Libre

Ecualizador paramétrico **local y gratuito** para el **micrófono** y el **audio del PC**,
con presets de voz y música, perfiles de 67 audífonos de marca (AutoEq) y ajuste automático.
No usa internet, no tiene cuentas, ni anuncios, ni servicios de pago. Tu audio nunca sale de tu PC.

## Cómo abrirlo

| Sistema | Paso |
|---|---|
| **Windows** | Doble clic en **`Iniciar-Ecualizador.bat`**. Se abre en Chrome o Edge en su propia ventana. Deja abierta la ventana negra (puedes minimizarla). |
| Linux / macOS | `./iniciar.sh` (usa `python3` para el servidor local). |

Usa **Chrome o Edge actualizados**: son los que permiten elegir la salida de audio (necesario para los cables virtuales).

## Qué incluye

- **Dos canales independientes**: Micrófono y Audio del PC, cada uno con su propia EQ, dinámica, entrada y salida. Pueden funcionar a la vez.
- **EQ paramétrico de hasta 24 bandas**: campana, shelf de graves/agudos, pasa altos, pasa bajos y notch. Arrastra los puntos en el gráfico, usa la rueda para el ancho (Q), doble clic para agregar y clic derecho para borrar.
- **Analizador de espectro** en tiempo real (original vs procesado) y medidores de nivel con aviso de saturación.
- **Presets de micrófono**: podcast, locutor de radio, streaming/gaming, llamadas, canto, quitar sibilancia, quitar zumbido de 50/60 Hz, cuarto con eco, micrófonos de laptop, y estilos aproximados de Shure SM7B, SM58, Electro-Voice RE20, Neumann U 87, RØDE PodMic y Blue Yeti/HyperX QuadCast.
- **Presets del PC**: géneros (reggaetón, salsa/cumbia, rock, electrónica, pop, jazz, clásica), películas, gaming competitivo, volumen bajo de noche, parlantes de laptop y más.
- **Marcas (AutoEq)**: corrección hacia la curva Harman para 67 audífonos populares (Sony WH-1000XM4/XM5, Sennheiser HD 600/650, AirPods Pro/Max, Bose QC, Beats, JBL Tune, Galaxy Buds, HyperX, Logitech, Razer, SteelSeries, Audio-Technica, AKG, Beyerdynamic…). También puedes **emular** el sonido de otro modelo.
- **Ajuste automático**:
  - *Voz broadcast / Voz natural*: mide tu voz y corrige la coloración del micrófono y del cuarto.
  - *Balance tonal*: ajusta suavemente el audio del PC según la música que suena.
  - *Parlantes + sala*: emite ruido rosa y lo mide con tu micrófono para corregir tus parlantes en tu cuarto.
- **Dinámica**: preamp automático anti-saturación, puerta de ruido, compresor, limitador y los filtros del navegador (supresión de ruido, eco y volumen automático).
- **Exportar** a Equalizer APO / Peace (`config.txt`), GraphicEQ (Wavelet en Android) y JSON. **Importar** cualquier `ParametricEQ.txt` de AutoEq o config de Equalizer APO.
- **Mis presets**: guarda, carga y respalda tus ajustes.

## Recetas

### Micrófono ecualizado en Discord, OBS, Zoom, Meet o WhatsApp
1. Instala **VB-Audio Virtual Cable** (gratis): <https://vb-audio.com/Cable/>.
2. Canal **Micrófono** → Entrada: tu micrófono · Salida: **CABLE Input** → **Iniciar**.
3. En Discord/OBS/Zoom elige como micrófono **CABLE Output**.

### Ecualizar todo el audio de Windows
- **Recomendado (latencia cero, sin dejar la app abierta):** instala [Equalizer APO](https://sourceforge.net/projects/equalizerapo/) (+ [Peace](https://sourceforge.net/projects/peace-equalizer-apo-extension/) si quieres interfaz). Diseña tu EQ aquí y usa **Exportar → config.txt** para reemplazar `C:\Program Files\EqualizerAPO\config\config.txt`. Equalizer APO también puede ecualizar el micrófono (marca tu micrófono en *Capture devices* del Configurator).
- **En tiempo real dentro de la app:** pon la salida de Windows en un cable virtual (si el micrófono ya usa VB-Cable, usa [VoiceMeeter](https://vb-audio.com/Voicemeeter/), gratis) y en el canal **Audio del PC** elige Entrada = salida del cable, Salida = tus audífonos o parlantes reales.

En macOS usa **BlackHole** (gratis) como cable virtual; en Linux, **EasyEffects** importa el `config.txt` de Equalizer APO.

## Problemas comunes

| Síntoma | Solución |
|---|---|
| Pide permiso del micrófono cada vez | Ábrelo con `Iniciar-Ecualizador.bat` (servidor local), no con doble clic en `index.html`. |
| No aparecen los nombres de los dispositivos | Botón **Permitir dispositivos** arriba a la derecha, o ↻ junto a «Entrada». |
| Pitido o eco | Estás enviando el audio a los mismos parlantes que capta la entrada. Usa audífonos o pon Salida = «Ninguna». |
| «SATURA» en rojo | Baja la ganancia de salida o la ganancia del compresor; deja el preamp en automático. |
| La puerta corta tus palabras | Baja el umbral del gate (más negativo) o sube el tiempo de cierre. |

## Créditos

- Perfiles de audífonos: [AutoEq](https://github.com/jaakkopasanen/AutoEq) de Jaakko Pasanen (licencia MIT), con mediciones de oratory1990, crinacle, Rtings y otros.
- Los presets «Estilo de marca» de micrófonos son aproximaciones inspiradas en las curvas de respuesta publicadas; no son presets oficiales de los fabricantes.
- Objetivo de voz basado en el espectro promedio de la voz (LTASS, Byrne et al. 1994).
