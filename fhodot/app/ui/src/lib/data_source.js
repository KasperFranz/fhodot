/**
 * A DataSource represents one data source from the Flask API
 *
 * Each data source has a layer on the map and can have one or more
 * tables that display underneath the map. The DataSource.refresh method
 * fetches new data from the Flask API (e.g. when the map is moved) and
 * refreshes the map layer and any tables.
 */

import { circleMarker, geoJson, LayerGroup } from "leaflet";
import { MarkerClusterGroup } from "leaflet.markercluster";

import { createClusterIcon, styleMarker } from "./marker_styling";
import { fetchAbortPrevious } from "./utils";

/**
 * Style a stats multipolygon feature according to proportion of matches
 */
const proportionStyle = (feature) => {
  const { stats } = feature.properties;
  let proportion;
  if (stats.unmatched_without_location) {
    proportion = stats.matched_same_postcodes
      / (stats.total - stats.unmatched_without_location);
  } else {
    proportion = stats.matched_same_postcodes / stats.total;
  }

  return {
    color: "rgb(70, 70, 70)",
    weight: 0.5,
    opacity: 1,
    fillColor: "rgb(122, 206, 0)",
    fillOpacity: proportion * 0.75,
  };
};

/**
 * Make district multipolygon transparent, grey out all others, trigger event
 */
const districtOnMouseOver = (e) => {
  e.target.setStyle({
    fillColor: "black",
    fillOpacity: 0.2,
  });
  e.sourceTarget.setStyle({
    fillOpacity: 0,
  });
  document.dispatchEvent(
    new CustomEvent(
      "districtMouseOver",
      { detail: e.sourceTarget.feature.properties },
    ),
  );
};

/**
 * Return district multipolygon fill colour to depend on match proportion
 */
const districtOnMouseOut = (e) => {
  e.target.eachLayer((layer) => {
    layer.setStyle(proportionStyle(layer.feature));
  });
  document.dispatchEvent(
    new CustomEvent("districtMouseOut"),
  );
};

/**
 * Trigger event on district click
 */
const districtOnClick = (e) => {
  document.dispatchEvent(
    new CustomEvent(
      "districtClick",
      { detail: e.sourceTarget.feature.properties },
    ),
  );
};

export default class DataSource {
  constructor(arg) {
    this.name = arg.name;
    this.type = arg.type; // used to determine correct layer switching
    if (!["fhrs", "osm"].includes(arg.type)) {
      throw new Error("DataSource type should be 'fhrs' or 'osm'");
    }
    this.label = arg.label;
    this.pointLayer = new MarkerClusterGroup({
      maxClusterRadius: 10,
      iconCreateFunction: createClusterIcon,
    });
    // optional line layer e.g. for showing distant matches
    this.lineLayer = arg.lineLayer || null;
    // optional stats layer to show when zoomed out
    this.statsLayer = (arg.statsJSONURL ? new LayerGroup() : null);
    this.jsonURL = arg.jsonURL;
    this.statsJSONURL = arg.statsJSONURL;
    this.markerClickFunction = arg.markerClickFunction;
    this.tables = arg.tables;
    this.keyboardShortcut = arg.keyboardShortcut;

    // layerGroup with all data source's layers, for adding to layer control
    const layers = [this.pointLayer];
    if (this.lineLayer) layers.push(this.lineLayer);
    if (this.statsLayer) layers.push(this.statsLayer);
    this.layerGroup = new LayerGroup(layers);
  }

  /**
   * Return true if this data source's layer group is enabled on the map
   */
  isEnabled(map) {
    return map.leafletMap.hasLayer(this.layerGroup);
  }

  /**
   * Add this DataSource's layer group to supplied SlippyMap
   */
  addLayerGroupTo(map) {
    this.layerGroup.addTo(map.leafletMap);
  }

  /**
   * Remove this DataSource's layer group from supplied SlippyMap
   */
  removeLayerGroupFrom(map) {
    this.layerGroup.removeFrom(map.leafletMap);
  }

  /**
   * Remove this DataSource's point markers from its pointLayer
   *
   * Doesn't remove the pointLayer itself from the layerGroup
   */
  clearPoints() {
    this.pointLayer.clearLayers();
  }

  /**
   * Remove this DataSource's lines from its lineLayer
   *
   * Doesn't remove the lineLayer itself from the layerGroup
   */
  clearLines() {
    if (this.lineLayer) this.lineLayer.clearLayers();
  }

  /**
   * Remove this DataSource's stats multipolygons from its statsLayer
   *
   * Doesn't remove the statsLayer itself from the layerGroup
   */
  clearStatsMultiPolygons() {
    if (this.statsLayer) this.statsLayer.clearLayers();
  }

  /**
   * Reload necessary data and refresh map/tables
   *
   * Return promise
   */
  refresh(map) {
    if (map.belowMinZoomWithMarkers) {
      return this.refreshBelowMinZoomWithMarkers(map);
    }
    return this.refreshAtOrAboveMinZoomWithMarkers(map);
  }

  /**
   * Clear stats layer and refresh markers/lines
   *
   * Return promise
   */
  refreshAtOrAboveMinZoomWithMarkers(map) {
    // remove stats multipolygons but leave layer within the group enabled
    this.clearStatsMultiPolygons();
    const url = new URL(this.jsonURL, window.location.href);
    url.search = new URLSearchParams(map.bboxParams);
    return fetchAbortPrevious(url)
      .then((response) => response.json())
      .then((data) => {
        this.replaceMarkersLines(data);
        this.updateTables(data);
      });
  }

  /**
   * Replace the map markers/lines using the supplied data
   */
  replaceMarkersLines(data) {
    // if there is a lineLayer, data will be split into points and lines
    const pointsData = this.lineLayer ? data.points : data;

    if (this.lineLayer) {
      const lines = geoJson(data.lines, {
        style: { color: "rgb(230, 0, 0)", weight: 4 },
      });

      // remove existing lines to prevent duplication
      this.clearLines();
      this.lineLayer.addLayer(lines);
    }

    // new set of markers from the GeoJSON data
    const markers = geoJson(pointsData, {
      pointToLayer: (feature, latlng) => circleMarker(latlng, {
        bubblingMouseEvents: false, // prevent unspiderfy on marker click
      }),
      style: styleMarker,
    });

    markers.on("click", (e) => (
      this.markerClickFunction(e.sourceTarget.feature.properties)
    ));

    // remove existing markers to prevent duplication
    this.clearPoints();
    this.pointLayer.addLayer(markers);
  }

  /**
   * Clear markers/lines and refresh stats layer
   *
   * Return promise
   */
  refreshBelowMinZoomWithMarkers(map) {
    // remove markers/lines but leave each layer within the group enabled
    this.clearPoints();
    this.clearLines();

    if (this.statsLayer) {
      const url = new URL(this.statsJSONURL, window.location.href);
      const params = new URLSearchParams(map.bboxParams);
      params.append("zoom", map.currentZoom);
      url.search = params;
      return fetchAbortPrevious(url)
        .then((response) => response.json())
        .then((data) => this.replaceStatsMultiPolygons(data));
    }

    return Promise.resolve(); // if no statsLayer
  }

  /**
   * Replace the map stats multipolygons using the supplied data
   */
  replaceStatsMultiPolygons(data) {
    // new set of district multipolygons from the GeoJSON data
    const districts = geoJson(data, {
      style: proportionStyle,
    });

    districts.on("mouseover", districtOnMouseOver);
    districts.on("mouseout", districtOnMouseOut);
    districts.on("click", districtOnClick);

    // remove existing markers to prevent duplication
    this.clearStatsMultiPolygons();
    this.statsLayer.addLayer(districts);
  }

  /**
   * Refresh each table using the supplied data
   */
  updateTables(data) {
    // if there is a lineLayer, data will be split into points and lines
    const pointsData = this.lineLayer ? data.points : data;
    this.tables.forEach((table) => table.refresh(pointsData));
  }
}
