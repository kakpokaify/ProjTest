from LxmlSoup import LxmlSoup
import requests
from bs4 import BeautifulSoup as bs
import pandas as pd

URL_TEMPLATE = "https://webparainmigrantes.com/lote-nie-avenida-poblados-madrid/"

URL_T = "https://icp.administracionelectronica.gob.es/icpplustiem/citar?p=28&locale=es"
PROVINCIAS_ARRAY = {'Madrid':28}


start_url = lambda prov : "https://icp.administracionelectronica.gob.es/icpplustiem/citar?p="+str(PROVINCIAS_ARRAY[prov])+"&locale=es"



def Parsing(url):
    r = requests.get(url)
    return (r.status_code)

if __name__ == '__main__':

    print(start_url("Madrid"))
    print(Parsing(URL_TEMPLATE))

    html = requests.get('https://sunlight.net/catalog').text
    soup = LxmlSoup(html)
    print(PROVINCIAS_ARRAY['Madrid'])

