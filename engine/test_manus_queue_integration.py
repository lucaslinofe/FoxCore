"""FOX integration tests: no real network, database writes, or Manus credits."""
import os
import unittest
from unittest.mock import patch
import main

OFFER={"short_url":"https://meli.la/2x5LgDV","title":"Cuba Gourmet Para Cozinha",
       "source_metadata":{"price":88},"status":"awaiting_product_identification",
       "last_match_status":None}

class QueueIntegrationTests(unittest.TestCase):
    def test_disabled_never_reads_queue(self):
        with patch.dict(os.environ,{"FOX_MANUS_ENABLED":"false"}), patch.object(main,"db") as db:
            main.dispatch_manus_queue()
            main.reconcile_manus_queue()
            db.assert_not_called()

    def test_dispatch_saves_task_id(self):
        writes=[]
        def fake_db(table,method="GET",data=None,params=None):
            if method=="PATCH":
                writes.append((table,data,params))
                return []
            if table=="fox_sources":
                return [{"name":"Pechinchou","authorized":True,"enabled":True}]
            return [dict(OFFER)]
        with patch.dict(os.environ,{"FOX_MANUS_ENABLED":"true"}), \
             patch.object(main,"db",side_effect=fake_db), \
             patch.object(main,"create_manus_task",return_value={"status":"accepted","task_id":"task_123"}):
            main.dispatch_manus_queue()
        self.assertEqual(len(writes),1)
        self.assertEqual(writes[0][1]["last_match_status"],"manus_submitted:task_123")
        self.assertEqual(writes[0][0],"fox_pechinchou_queue")

    def test_reconcile_only_verified_product(self):
        writes=[]
        def fake_db(table,method="GET",data=None,params=None):
            if method=="PATCH":
                writes.append(data)
                return []
            if table=="fox_sources":
                return [{"name":"Pechinchou","authorized":True,"enabled":True}]
            return [{"short_url":OFFER["short_url"],"status":"awaiting_product_identification",
                     "last_match_status":"manus_submitted:task_123"}]
        result={"status":"resolved","product_url":"https://www.mercadolivre.com.br/p/MLB12345678",
                "catalog_id":"MLB12345678","listing_id":None}
        with patch.dict(os.environ,{"FOX_MANUS_ENABLED":"true"}), \
             patch.object(main,"db",side_effect=fake_db), \
             patch.object(main,"check_task",return_value=result):
            main.reconcile_manus_queue()
        self.assertEqual(writes[0]["status"],"product_identified")
        self.assertEqual(writes[0]["product_code"],"MLB12345678")

    def test_pending_does_not_write(self):
        with patch.dict(os.environ,{"FOX_MANUS_ENABLED":"true"}), \
             patch.object(main,"db",side_effect=lambda table,**kwargs: (
                 [{"name":"Pechinchou","authorized":True,"enabled":True}]
                 if table=="fox_sources" else [{"short_url":OFFER["short_url"],
                 "last_match_status":"manus_submitted:task_123"}])) as db, \
             patch.object(main,"check_task",return_value={"status":"pending"}):
            main.reconcile_manus_queue()
        self.assertTrue(all(call.args[1]!="PATCH" if len(call.args)>1 else True
                            for call in db.call_args_list))

if __name__=="__main__": unittest.main()
