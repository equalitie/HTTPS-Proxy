git clone https://github.com/EFForg/https-everywhere.git
cd https-everywhere
sh ./makecrx.sh
mv ./pkg/crx/rules/default.rulesets ../httpse.rulesets
cd ..
rm -rf https-everywhere
