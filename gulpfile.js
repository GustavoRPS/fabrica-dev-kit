/* ==========================================================================
   Yes We Work WordPress + Vagrant development kit
   ========================================================================== */

var gulp = require('gulp'),
	autoprefixer = require('autoprefixer'),
	browserSync = require('browser-sync').create(),
	del = require('del'),
	beml = require('gulp-beml'),
	concat = require('gulp-concat'),
	changed = require('gulp-changed'),
	csslint = require('gulp-csslint'),
	cssnano = require('gulp-cssnano'),
	gulpFilter = require('gulp-filter'),
	flatten = require('gulp-flatten'),
	imagemin = require('gulp-imagemin'),
	jshint = require('gulp-jshint'),
	postcss = require('gulp-postcss'),
	rename = require('gulp-rename'),
	sourcemaps = require('gulp-sourcemaps'),
	tap = require('gulp-tap'),
	fs = require('fs'),
	uglify = require('gulp-uglify'),
	lost = require('lost'),
	mainBowerFiles = require('main-bower-files'),
	postcssFontpath = require('postcss-fontpath'),
	postcssMixins = require('postcss-mixins'),
	postcssNested = require('postcss-nested'),
	postcssNestedProps = require('postcss-nested-props'),
	postcssSimpleVars = require('postcss-simple-vars'),
	shell = require('shelljs'),
	ftp = require('vinyl-ftp'),
	YAML = require('yamljs');

// Default project settings
var projectSlug = 'yww-project';
var projectUrl = 'yeswework.dev';
var projectName = 'YWW Project';
var projectAuthor = 'Yes We Work - http://yeswework.com/';

// Overwrite with defaults from Vagrant's YML file in the parent folder, if available
var projectSettings = YAML.load('site.yml');
if(typeof projectSettings.slug != 'undefined' && projectSettings.slug != '') {
	var projectSlug = projectSettings.slug;
}
if(typeof projectSettings.hostname != 'undefined' && projectSettings.hostname != '') {
	var projectUrl = projectSettings.hostname;
}
if(typeof projectSettings.title != 'undefined' && projectSettings.title != '') {
	var projectName = projectSettings.title;
}

// Paths for remapping
var base = {
	src: './dev/src/',
	build: './dev/build/',
	theme: './www/wordpress/wp-content/themes/' + projectSlug + '/'
};

// Globs for each file type
var glob = {
	acfTheme: base.theme + 'acf-json/*.json',
	acf: base.src + 'acf-json/*.json',
	bower: base.src + 'bower_components/**/*.php',
	includes: [base.src + 'includes/**/*.php', base.src + 'includes/.env'],
	controllers: base.src + 'templates/controllers/**/*.php',
	views: base.src + 'templates/**/*.twig',
	styles: base.src + 'assets/css/**/*.{css,pcss}',
	scripts: base.src + 'assets/js/**/*.js',
	images: base.src + 'assets/img/**/*',
	fonts: base.src + 'assets/fonts/**/*'
};

// Build folder slugs
var dest = {
	acf: 'acf-json',
	includes: 'inc',
	controllers: '', // need to go in the root theme folder
	views: 'views',
	styles: 'css',
	scripts: 'js',
	images: 'img',
	fonts: 'fonts'
};

// Plugin options
var options = {
	uglify: {mangle: false},
	imagemin: {optimizationLevel: 7, progressive: true, interlaced: true, multipass: true},
	postcss: [
		postcssMixins,
		postcssSimpleVars,
		postcssNestedProps,
		postcssNested,
		postcssFontpath,
		lost,
		autoprefixer({browsers: ['last 3 versions']})
	],
	beml: {
		elemPrefix: '__',
		modPrefix: '--',
		modDlmtr: '-'
	}
};

// Before cleaning, retrieve latest ACF JSON from live theme (delete first)
// These are the only tasks which modify the src folder
function acfClean() {
	return del(base.src + dest.acf);
}
function acfPull() {
	return gulp.src(glob.acfTheme)
		.pipe(gulp.dest(base.src + dest.acf));
}

// Erase build and theme folders before each compile
function clean() {
	return del([base.build, base.theme], {force: true});
}

// Bower: concatenate "main files" into library script and stylesheet and copy
function bower() {
	var jsFilter = gulpFilter('**/*.js', {restore: true});
	var cssFilter = gulpFilter('**/*.css', {restore: true});
	return gulp.src(mainBowerFiles({paths: base.src}))
		.pipe(jsFilter)
		.pipe(concat('lib.js'))
		.pipe(sourcemaps.init())
		.pipe(changed(base.build + dest.scripts))
		.pipe(gulp.dest(base.build + dest.scripts))
		.pipe(gulp.dest(base.theme + dest.scripts))
		.pipe(browserSync.stream())
		.pipe(uglify(options.uglify))
		.pipe(rename('lib.min.js'))
		.pipe(sourcemaps.write('.'))
		.pipe(changed(base.build + dest.scripts))
		.pipe(gulp.dest(base.build + dest.scripts))
		.pipe(gulp.dest(base.theme + dest.scripts))
		.pipe(browserSync.stream())
		.pipe(jsFilter.restore)
		.pipe(cssFilter)
		.pipe(concat('lib.css'))
		.pipe(sourcemaps.init())
		.pipe(changed(base.build + dest.styles))
		.pipe(gulp.dest(base.build + dest.styles))
		.pipe(gulp.dest(base.theme + dest.styles))
		.pipe(browserSync.stream({match: '**/*.css'}))
		.pipe(cssnano())
		.pipe(rename('lib.min.css'))
		.pipe(sourcemaps.write('.'))
		.pipe(changed(base.build + dest.styles))
		.pipe(gulp.dest(base.build + dest.styles))
		.pipe(gulp.dest(base.theme + dest.styles))
		.pipe(browserSync.stream({match: '**/*.css'}));
}

// style.css: auto-create our theme's style.css using project info we already have
function styleCss(cb) {
	var data = '/*\r\n'
		+ 'Theme Name: ' + projectName + '\r\n'
		+ 'Theme URI: http://' + projectUrl + '\r\n'
		+ 'Author: ' + projectAuthor + '\r\n' + '*/';
	fs.writeFileSync(base.build + 'style.css', data);
	fs.writeFileSync(base.theme + 'style.css', data);
	cb(); // indicate completion
}

// Put ACF JSON back (previously saved with acfPull task)
function acf() {
	fs.mkdirSync(base.theme + dest.acf); // Create this folder under any circumstances, so ACF saves to it
	return gulp.src(glob.acf)
		.pipe(gulp.dest(base.build + dest.acf))
		.pipe(gulp.dest(base.theme + dest.acf));
}

// Includes: copy internal PHP dependencies to an inc folder and auto-create functions.php with includes
function includes() {
	fs.writeFileSync(base.build + 'functions.php', '<?php\r\n'); // create a blank functions.php
	fs.writeFileSync(base.theme + 'functions.php', '<?php\r\n');
	var nonVendorFilter = gulpFilter('*.php', {restore: true}); // only require top-level files in functions.php
	return gulp.src(glob.includes)
		.pipe(nonVendorFilter)
		.pipe(tap(function(file, t) {// write an include for this file to our functions.php automatically
			fs.appendFileSync(base.build + 'functions.php', "require_once(get_stylesheet_directory() . '/" + dest.includes + "/" + file.path.replace(file.base, '') + "');\r\n");
			fs.appendFileSync(base.theme + 'functions.php', "require_once(get_stylesheet_directory() . '/" + dest.includes + "/" + file.path.replace(file.base, '') + "');\r\n");
		}))
		.pipe(nonVendorFilter.restore)
		.pipe(changed(base.build + dest.includes))
		.pipe(gulp.dest(base.build + dest.includes))
		.pipe(gulp.dest(base.theme + dest.includes))
		.pipe(browserSync.stream());
}

// Controllers: copy PHP files, flattening tree
function controllers() {
	return gulp.src(glob.controllers)
		.pipe(flatten())
		.pipe(changed(base.build + dest.controllers))
		.pipe(gulp.dest(base.build + dest.controllers))
		.pipe(gulp.dest(base.theme + dest.controllers))
		.pipe(browserSync.stream());
}

// Views: copy Twig files, flattening tree
function views() {	return gulp.src(glob.views)
		.pipe(flatten())
		.pipe(changed(base.build + dest.views))
		// .pipe(beml(options.beml))
		.pipe(gulp.dest(base.build + dest.views))
		.pipe(gulp.dest(base.theme + dest.views))
		.pipe(browserSync.stream());
}

// Styles (CSS): lint, concatenate into one file, write source map, postcss, save full and minified versions, then copy
function styles() {
	var lintFilter = gulpFilter(['**/*', '!defaults.css', '!helpers.css'], {restore: true});
	return gulp.src(glob.styles)
		.pipe(postcss(options.postcss))
		.pipe(lintFilter) // don't lint certain files which we use on all projects
		.pipe(csslint({'font-sizes': false, 'box-model': false, 'compatible-vendor-prefixes': false, 'font-faces': false}))
		.pipe(csslint.reporter())
		.pipe(lintFilter.restore) // restore all files after linting
		.pipe(concat('main.css'))
		.pipe(sourcemaps.init())
		.pipe(changed(base.build + dest.styles))
		.pipe(gulp.dest(base.build + dest.styles))
		.pipe(gulp.dest(base.theme + dest.styles))
		.pipe(browserSync.stream({match: '**/*.css'}))
		.pipe(cssnano())
		.pipe(rename('main.min.css'))
		.pipe(sourcemaps.write('.'))
		.pipe(changed(base.build + dest.styles))
		.pipe(gulp.dest(base.build + dest.styles))
		.pipe(gulp.dest(base.theme + dest.styles))
		.pipe(browserSync.stream({match: '**/*.css'}));
}

// Scripts (JS): lint, concatenate into one file, save full and minified versions, then copy
function scripts() {
	return gulp.src(glob.scripts)
		.pipe(jshint())
		.pipe(jshint.reporter())
		.pipe(concat('main.js'))
		.pipe(sourcemaps.init())
		.pipe(changed(base.build + dest.scripts))
		.pipe(gulp.dest(base.build + dest.scripts))
		.pipe(gulp.dest(base.theme + dest.scripts))
		.pipe(browserSync.stream())
		.pipe(uglify(options.uglify))
		.pipe(rename('main.min.js'))
		.pipe(sourcemaps.write('.'))
		.pipe(changed(base.build + dest.scripts))
		.pipe(gulp.dest(base.build + dest.scripts))
		.pipe(gulp.dest(base.theme + dest.scripts))
		.pipe(browserSync.stream());
}

// Images: optimise and copy, maintaining tree
function images() {
	return gulp.src(glob.images)
		.pipe(changed(base.build + dest.images))
		.pipe(imagemin(options.imagemin))
		.pipe(gulp.dest(base.build + dest.images))
		.pipe(gulp.dest(base.theme + dest.images))
		.pipe(browserSync.stream());
}

// Fonts: just copy, maintaining tree
function fonts() {
	return gulp.src(glob.fonts)
		.pipe(changed(base.build + dest.fonts))
		.pipe(gulp.dest(base.build + dest.fonts))
		.pipe(gulp.dest(base.theme + dest.fonts))
		.pipe(browserSync.stream());
}

// Build: sequences all the other tasks
gulp.task('build', gulp.series(acfClean, acfPull, clean, bower, gulp.parallel(styleCss, acf, includes, controllers, views, styles, scripts, images, fonts)));

// Install: tell Vagrant to activate the built theme
gulp.task('install', gulp.series('build', activate));
function activate(cb) {
	shell.exec('vagrant ssh -c "wp theme activate ' + projectSlug + '"');
	cb(); // indicate completion
}

// Watch: fire build, then watch for changes
gulp.task('default', gulp.series('build', watch));
function watch() {
	browserSync.init({
		proxy: projectUrl,
		open: false
	});
	gulp.watch(glob.styles, gulp.series(styles));
	gulp.watch(glob.bower, gulp.series(bower));
	gulp.watch(glob.includes, gulp.series(includes));
	gulp.watch(glob.controllers, gulp.series(controllers));
	gulp.watch(glob.views, gulp.series(views));
	gulp.watch(glob.scripts, gulp.series(scripts));
	gulp.watch(glob.images, gulp.series(images));
	gulp.watch(glob.fonts, gulp.series(fonts));
	gulp.watch(glob.acfTheme, gulp.series(acfClean, acfPull));
}
