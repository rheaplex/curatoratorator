////////////////////////////////////////////////////////////////////////////////
// Imports
////////////////////////////////////////////////////////////////////////////////

var async = require('async'),
    _ = require('underscore');

var traverson = require('traverson'),
    JsonHalAdapter = require('traverson-hal');

var config = require('./config.json'),
    xappToken = config.token;

////////////////////////////////////////////////////////////////////////////////
// API setup
////////////////////////////////////////////////////////////////////////////////

traverson.registerMediaType(JsonHalAdapter.mediaType, JsonHalAdapter);

var api = traverson.jsonHal.from('https://api.artsy.net/api');

////////////////////////////////////////////////////////////////////////////////
// Fetching objects via the API
////////////////////////////////////////////////////////////////////////////////

var followWith = function (link, params, callback) {
  api.newRequest()
  .follow(link)
  .withRequestOptions({
    headers: {
      'X-Xapp-Token': xappToken,
      'Accept': 'application/vnd.artsy-v2+json'
    }
  })
  .withTemplateParameters(params)
  .getResource(callback);
};

var followArtist = function (artist_id, callback) {
  followWith('artist', { id: artist_id }, callback );
};

var followSimilarContemporary = function (artist_id, count, callback) {
  followWith('artists',
           { similar_to_artist_id: artist_id,
             similarity_type: 'contemporary',
             size: count },
             function (err, result) { callback(err,
                                               result._embedded.artists); });
};

var followGenes = function (artist_id, callback) {
  followWith('genes',
           { artist_id: artist_id,
             // We're unlikely to get 100, so this will fetch all without paging
             size: 100 },
             function (err, result) { callback( err,
                                                result._embedded.genes); });
};

var followGenesToArtist = function (artistObject, callback) {
  followGenes(artistObject.id, function (err, genes) {
    if (err) {
      callback("Couldn't get genes", null);
    } else {
      artistObject.genes = genes;
      callback(err, artistObject);
    }
  });
};

var followGenesToArtists = function (artistsObjects, callback) {
  async.each(artistsObjects, followGenesToArtist, function (err, result) {
    callback(err, artistsObjects); });
};

var followSimilarOrderedByGenes = function (artist, results_callback) {
  async.waterfall([
    function (callback) {
      followGenesToArtist(artist, callback); },
    function (artist, callback) {
      followSimilarContemporary(artist.id,
                                100,
                                callback); },
    function (artists, callback) {
      followGenesToArtists(artists, callback); },
    function (artists, callback) {
      callback(null, artistsByGenesSimilarity(artist, artists));
    }
  ], function (err, results) {
       results_callback(err, results);
     });
};

////////////////////////////////////////////////////////////////////////////////
// Getting properties from fetched objects
////////////////////////////////////////////////////////////////////////////////

var artistsNames = function (artists) {
  return artists.map(function (artist) { return artist.name; });
};

var artistsDescs = function (artists) {
  return artists.map(function (artist){
           return [artist.name,
                   artist.birthday,
                   artist.location,
                   artist.nationality];
         });
};

var genesNames = function (genes) {
  return genes.map(function (gene) {
           return gene.name;
         });
};

////////////////////////////////////////////////////////////////////////////////
// Similarity
////////////////////////////////////////////////////////////////////////////////

var genesSimilarities = function (target_artist_object, other_artists_array) {
  var target_genes = genesNames(target_artist_object.genes),
      scale = 1.0 / target_genes.length;
  return other_artists_array.map(function (artist) {
           return scale * _.intersection(target_genes,
                                         genesNames(artist.genes)).length;
         });
};

// FIXME: add similarity to wrapper object, not actual object

var genesSimilarityToArtist = function (target_artist_object,
                                        other_artist_object) {
  var target_genes = genesNames(target_artist_object.genes),
      other_genes = genesNames(other_artist_object.genes),
      scale = 1.0 / target_genes.length;
  other_artist_object.similarity = scale * _.intersection(target_genes,
                                                          other_genes).length;
};

var genesSimilaritiesToArtists = function (target_artist_object,
                                           other_artists_array) {
  other_artists_array.forEach(function (artist) {
    genesSimilarityToArtist(target_artist_object, artist);
  });
};

var artistsByGenesSimilarity = function (target_artist_object,
                                         other_artists_array) {
  genesSimilaritiesToArtists(target_artist_object, other_artists_array);
  var artists_by_similarity = _.sortBy(other_artists_array, 'similarity');
  artists_by_similarity.reverse();
  return artists_by_similarity;
};


////////////////////////////////////////////////////////////////////////////////
// Filtering
////////////////////////////////////////////////////////////////////////////////

var artistsWithSimilarity = function (artists, similarity) {
  return artists.filter(function (artist) {
           return artist.similarity >= similarity;
         });
};

////////////////////////////////////////////////////////////////////////////////
// Reports
////////////////////////////////////////////////////////////////////////////////

var genesCounts = function (artists) {
  var genes = [];
  _.each(artists, function (artist) {
    genes = genes.concat(genesNames(artist.genes));
  });
  return _.countBy(genes, function(x) { return x; })
};

var genesCountsOrdered = function (artists, minimum_count) {
  var counts = _.mapObject(genesCounts(artists),
                           function(value, key) {
                             return {'gene': key, 'count': value};
                           });
  counts = _.filter(counts, function (x) { return x.count >= minimum_count; } );
  counts = _.sortBy(counts, 'count');
  counts.reverse();
  return counts;
};

var describeGenesCountsOrdered = function (artists, minimum_count) {
  return '<p>' + genesCountsOrdered(artists, minimum_count).map(function(gene) {
                   return gene.gene + ' ('+ gene.count + ')';
                 }).join(', ') + '.</p>';
};

var describeSimilarArtist = function (artist) {
  var bio = '';
  if (artist.nationality && artist.birthday) {
    bio = "<p><strong>(" + artist.nationality  + ", " + artist.birthday
        + ")</strong></p>\n";
  } else if (artist.nationality) {
    bio = "<p><strong>(" + artist.nationality + ")</strong></p>\n";
  } else if (artist.birthday) {
    bio = "<p><strong>(" + artist.birthday + ")</strong></p>\n";
  }
  var img = '';
  if (artist._links.thumbnail) {
    img = '<img src="' + artist._links.thumbnail.href + '"';
  } else {
    img = '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH3wweFzUXYgE7cwAAABl0RVh0Q29tbWVudABDcmVhdGVkIHdpdGggR0lNUFeBDhcAAAAMSURBVAjXY3j27BkABWgCs9Pm25QAAAAASUVORK5CYII=" width="300" height="225"';
  }
  return '<h3><a href="' + artist._links.permalink.href + '">' +artist.name
       + '</a> <small>(' +  parseFloat(artist.similarity).toFixed(2)
       + ')</small></h3>'
       + img + ' style="margin-bottom: 16px;">'
       + bio
       + "\n<p>"
       + genesNames(artist.genes).join(", ")
       + ".</p>\n";
};

////////////////////////////////////////////////////////////////////////////////
// Main flow of execution
////////////////////////////////////////////////////////////////////////////////

var AndyWarhol = '4d8b92b34eb68a1b2c0003f4';

followArtist(AndyWarhol,
            function (err, artist) {
              followSimilarOrderedByGenes(artist, function(err, artists) {
                console.log('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="X-UA-Compatible" content="IE=edge"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Curatorator</title><link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/3.3.6/css/bootstrap.min.css" integrity="sha384-1q8mTJOASx8j1Au+a5WDVnPi2lkFfwwEAa8hDDdjZlpLegxhjVME1fgjWPGmkzs7" crossorigin="anonymous"><!--[if lt IE 9]><script src="https://oss.maxcdn.com/html5shiv/3.7.2/html5shiv.min.js"></script><script src="https://oss.maxcdn.com/respond/1.4.2/respond.min.js"></script><![endif]--></head><body><div class="container" role="main"><br><div class="jumbotron">');
                console.log('<h1><a href="' + artist._links.permalink.href
                           + '">' + artist.name + '</a></h1><img src="'
                           + artist._links.thumbnail.href + '"></div>');
                console.log('<div class="page-header"><h1>Show Themes</h1></div>');
                console.log(describeGenesCountsOrdered(artists.concat(artist),
                                                       10));
                console.log('<div class="page-header"><h1>Featured Artists</h1></div>');
                artistsWithSimilarity(artists, 0.1).forEach(function (artist) {
                  console.log(describeSimilarArtist(artist));
                });
                console.log('<hr><p><small>All data via <a href="https://artsy.net/">artsy.net\'s <a href="https://developers.artsy.net/">API</a>.</small></p></div><script src="https://ajax.googleapis.com/ajax/libs/jquery/1.11.3/jquery.min.js"></script><script src="js/bootstrap.min.js"></script></body></html>')
              });
            });

/*followWith('artist', { id: 'andy-warhol' },
           function(error, andyWarhol) {
             console.log(andyWarhol.name + 'was born in ' + andyWarhol.birthday + ' in ' + andyWarhol.hometown);
           });*/

/*followGenes('4d8b92b34eb68a1b2c0003f4', function (error, genes) {
  console.log(genesNames(genes).join(', ') + '.');
});*/

/*followSimilarContemporary('4d8b92b34eb68a1b2c0003f4',
                          100,
                          function (error, similar) {
                            followGenesToArtists (similar, callback)
                            if (! error) {
                              var artists = similar._embedded.artists;
                              console.log(artistsDetails(artists)
                                          .forEach(function (artist) {
                                            console.log(artist.join('; '));
                                          }));
                              //console.log(JSON.stringify(artists, null, 4));
                              console.log(artistsNames(artists).join("\n"));
                            }
                          });
*/
