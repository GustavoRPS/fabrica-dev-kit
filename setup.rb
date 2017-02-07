#!/usr/bin/env ruby

# =============================================================================
# Fabrica setup script
# =============================================================================
# IMPORTANT: before running this script, rename setup-example.yml to setup.yml
# and modify it with project info. see README.md for more info
# =============================================================================

require 'erb'
require 'fileutils'
require 'json'
require 'yaml'
require 'ostruct'
require 'net/http'

# maximum time (in seconds) to wait for wp container to be up and running
WAIT_WP_CONTAINER_TIMEOUT = 360

# formatted output methods
def echo(message)
	puts "\e[7m[Fabrica]\e[27m 🏭  #{message}"
end
def halt(message)
	abort "\e[1m\e[41m[Fabrica]\e[0m 🏭  #{message}"
end

# check Fabrica dependencies
dependencies = ['gulp', 'vagrant', 'composer']
for dependency in dependencies
	if not system("hash #{dependency} 2>/dev/null")
		halt "Could not find dependency '#{dependency}'."
	end
end
package_manager = ''
dependencies = ['yarn', 'npm']
for dependency in dependencies
	if system("hash #{dependency} 2>/dev/null")
		package_manager = dependency
		break
	end
end
if package_manager == ''
	halt "Could not find any Node package manager ('yarn' or 'npm')."
end

echo 'Reading settings...'
# auxiliar methods to merge settings in the files
class Hash
	def deep_merge!(other_hash)
		other_hash.each_pair do |current_key, other_value|
			this_value = self[current_key]
			if self[current_key].is_a?(Hash) && other_value.is_a?(Hash)
				self[current_key].deep_merge!(other_value)
			else
				self[current_key] = other_value
			end
		end
		return self
	end

	def merge_settings!(settings_filename)
		return {} if not File.exists?(settings_filename)
		new_settings = YAML.load_file(settings_filename)
		self.deep_merge!(new_settings) if new_settings.is_a?(Hash)
		return new_settings
	end
end
# load default, user and project/site settings, in that order
settings = YAML.load_file(File.join(File.dirname(__FILE__), 'provision/default.yml'))
settings.merge_settings!(File.join(ENV['HOME'], '.fabrica/settings.yml'))
setup_settings_filename = File.join(File.dirname(__FILE__), 'setup.yml')
if not File.exists?(setup_settings_filename)
	halt 'Could not load "setup.yml". Please create this file based on "setup-example.yml".'
end
settings.merge_settings!(setup_settings_filename)

# rename/backup "setup.yml"
FileUtils.mv 'setup.yml', 'setup.bak.yml'

if Dir.exists? 'dev'
	# working on an existing project
	FileUtils.cd 'dev'
	if not File.exists? 'src/package.json'
		halt 'Folder \'dev/\' already exists but no \'package.json\' found there.'
	end
	project_settings = JSON.parse(File.read('src/package.json'))
	echo 'Existing project \'dev/src/package.json\' found. Overriding the following settings in \'setup.yml\' with those in this file  (old \'setup.rb\' value → new value):'
	{'name' => 'slug', 'description' => 'title', 'author' => 'author'}.each do |project_key, setting_key|
		echo " ◦ #{setting_key} / #{project_key}: '#{settings[setting_key]}' → '#{project_settings[project_key]}'"
		settings[setting_key] = project_settings[project_key]
	end
	echo " ◦ web.dev_port / config.port: '#{settings['web']['dev_port']}' → '#{project_settings['config']['port']}'"
	settings['web']['dev_port'] = project_settings['config']['port']
else
	# new project: copy starter dev folder (this will preserve changes if/when kit updated)
	FileUtils.cp_r 'dev-starter', 'dev'
	FileUtils.cd 'dev'

	# set configuration data in source and Wordmove files
	settingsostruct = OpenStruct.new(settings)
	templateFilenames = [
		'src/package.json',
		'src/includes/.env',
		'src/includes/composer.json',
		'src/includes/project.php',
		'src/templates/views/base.twig',
		'Movefile',
		'docker-compose.yml'
	]
	for destFilename in templateFilenames
		srcFilename = "#{destFilename}.erb"
		if File.exists?(srcFilename)
			template = File.read srcFilename
			file_data = ERB.new(template, nil, ">").result(settingsostruct.instance_eval { binding })
			File.open(destFilename, 'w') {|file| file.puts file_data }
			FileUtils.rm srcFilename
		else
			halt "Could not find #{srcFilename} template."
		end
	end
end

# install build dependencies (Gulp + extensions)
echo 'Installing build dependencies...'
system "#{package_manager} install"

# install initial front-end dependencies
echo 'Installing front-end dependencies...'
FileUtils.cd 'src'
system "#{package_manager} install"
FileUtils.cd 'includes'
system 'composer install'
FileUtils.cd '../..'

# start docker
echo 'Bringing Docker containers up...'
if not system 'docker-compose up -d'
	halt 'Docker containers provision failed.'
end

# wait until wp container to install WordPress
echo "Waiting for \'#{settings['slug']}_wp\' container..."
response = ''
sleep 10
(WAIT_WP_CONTAINER_TIMEOUT - 10).times do
	Net::HTTP.start('localhost', settings['web']['dev_port']) {|http| response = http.head('/wp-admin/install.php').code } rescue nil
	break if response == '200'
	print '•'; sleep 1
end
puts ''
if response != '200'
	abort "More than #{WAIT_WP_CONTAINER_TIMEOUT} seconds elapsed while waiting for WordPress container to start."
end

# install WordPress in container
echo 'Installing for WordPress...'
$wp_container = "#{settings['slug']}_wp"
def wp(command)
	system "docker exec #{$wp_container} wp #{command}"
end
# [TODO] add `wp-config.php` settings
wp "core install \
    --url=localhost:#{settings['web']['dev_port']} \
    --title=\"#{settings['title']}\" \
    --admin_user=#{settings['wp']['admin']['user']} \
    --admin_password=#{settings['wp']['admin']['pass']} \
    --admin_email=\"#{settings['wp']['admin']['email']}\""
wp "rewrite structure \"#{settings['wp']['rewrite_structure']}\""
if settings['wp']['lang'] == 'ja'
	# activate multibyte patch for Japanese language
	wp "plugin activate wp-multibyte-patch"
end

# run our gulp build task and build the WordPress theme
echo 'Building WordPress theme...'
system 'gulp build'
# create symlink to theme folder in dev for quick access
FileUtils.ln_s "www/wp-content/themes/#{settings['slug']}/", 'build'
# activate theme
wp "theme activate \"#{settings['slug']}\""

# install and activate WordPress plugins
(settings['wp']['plugins'] || []).each do |plugin|
	wp "plugin install \"#{plugin}\" --activate"
end
# remove default WordPress plugins and themes
if settings['wp']['skip_default_plugins']
	wp "plugin delete \"hello\" \"akismet\""
end
if settings['wp']['skip_default_themes']
	wp "theme delete \"twentysixteen\" \"twentyfifteen\" \"twentyfourteen\""
end
# WordPress options
(settings['wp']['options'] || []).each do |option, value|
	wp "option update #{option} \"#{value}\""
end

# the site will be ready to run and develop locally
# just run gulp
echo 'Setup complete. To develop locally, \'cd dev\' then run \'gulp\'.'	
